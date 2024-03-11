import {ReadableOptions, WritableOptions} from "stream";
import { FieldManager, FieldConfig } from './sync.js';
import {PosixSemaphore, AsyncPosixSemaphore, SemaphoreOptions} from "./semaphore.js";
import {BufferOptions} from "./shbuf.js";
import {SharedBufferReadStream, SharedBufferWriteStream} from "./stream.js";
import {logger} from "./utils.js";

export const RINGBUF_HEADER_STR = 'RING1';

export const headerConfig: FieldConfig = {
    headerStr: {
        offset: 0,
        size: RINGBUF_HEADER_STR.length,
    },
    writerOffset: {
        offset: RINGBUF_HEADER_STR.length,
        size: 8
    },
    size: {
        offset: RINGBUF_HEADER_STR.length + 8,
        size: 8
    },
    readerCount: {
        offset: RINGBUF_HEADER_STR.length + 16,
        size: 8,
    },
    readerWaiting: {
        offset: RINGBUF_HEADER_STR.length + 24,
        size: 8
    },
    readerReady: {
        offset: RINGBUF_HEADER_STR.length + 32,
        size: 8
    }
};

let accum = 0;
Object.values(headerConfig).forEach(info => accum += info.size);
export const RING_HEADER_SIZE = accum;

export class RingBufferHeader extends FieldManager {
    constructor(buffer: Buffer, prefix: string, semOptions?: SemaphoreOptions) {
        super(buffer, headerConfig, prefix, semOptions);
    }

    async initializeHeader(): Promise<void> {
        const sems: AsyncPosixSemaphore[] = await this.acquireMultiple(Object.keys(headerConfig));
        this._setSequence('headerStr', Buffer.from(new TextEncoder().encode(RINGBUF_HEADER_STR)));
        this._setValue('writerOffset',  BigInt(0));
        this._setValue('size',  BigInt(0));
        this._setValue('readerCount',  BigInt(0));
        this._setValue('readerWaiting',  BigInt(0));
        this._setValue('readerReady', BigInt(0));
        sems.forEach(s => s.post());
    }

    async getWriterOffset(): Promise<bigint> {
        return await this.getValue('writerOffset');
    }

    async setWriterOffset(offset: bigint) {
        return await this.setValue('writerOffset', offset);
    }

    async getSize(): Promise<bigint> {
        return await this.getValue('size');
    }

    async decrementReaderCount() {
        const sem = await this.acquire('readerCount');
        const readerCount = this._getValue('readerCount');
        this._setValue('readerCount', readerCount - BigInt(1));
        sem.post();
    }

    async incrementReaderReady() {
        const sem = await this.acquire('readerReady');
        const readerReady = this._getValue('readerReady');
        this._setValue('readerReady', readerReady + BigInt(1));
        sem.post();
    }

    async incrementReaderWaiting() {
        const sem = await this.acquire('readerWaiting');
        const readerWaiting = this._getValue('readerWaiting') + BigInt(1);
        this._setValue('readerWaiting', readerWaiting);
        sem.post();
        return readerWaiting;
    }

    async decrementReaderWaiting() {
        const sem = await this.acquire('readerWaiting');
        const readerWaiting = this._getValue('readerWaiting') - BigInt(1);
        this._setValue('readerWaiting', readerWaiting);
        sem.post();
        return readerWaiting;
    }
}

export class RingBufferStreamWriter extends SharedBufferWriteStream {

    private readonly header: RingBufferHeader;

    // used by writer to indicate there is new data to be read
    private readonly writeLock: AsyncPosixSemaphore;

    // used by readers to indicate they are ready to receive new batch
    private readonly readersLock: AsyncPosixSemaphore;

    constructor(
        key: number,
        size: number,
        options?: WritableOptions,
        bufferOptions?: BufferOptions
    ) {
        super(key, size + RING_HEADER_SIZE, options, bufferOptions);

        this.header = new RingBufferHeader(
            this.shmBuffer.buffer, String(key),
            {create: true, existOk: false, initialValue: 1, permissions: 0o666}
        );
        this.writeLock = new AsyncPosixSemaphore(
            `ring.${key}.write`,
            {create: true, existOk: false, initialValue: 0, permissions: 0o666}
        );
        this.readersLock = new AsyncPosixSemaphore(
            `ring.${key}.readers`,
            {create: true, existOk: false, initialValue: 0, permissions: 0o666}
        );
    }

    async init() {
        await this.header.initializeHeader();
        this.resetWriter(RING_HEADER_SIZE);
        logger.debug('writer init');
    }

    async deinit() {
        await this.header.close(true);
        this.writeLock.close();
        this.writeLock.unlink();
        this.readersLock.close();
        this.readersLock.unlink();
        await this.writeLock.stop();
        await this.readersLock.stop();
        this.detach();
        this.remove();
        logger.debug(`writer deinit`);
    }

    writePost() {
        this.writeLock.post();
        logger.debug(`writer post`);
    }

    async _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): Promise<void> {
        try {
            if (!Buffer.isBuffer(chunk))
                throw new Error('Chunk must be a Buffer');

            const availableSize = this.size - this.writeOffset;

            if (chunk.length > availableSize) {  // buffer is gonna be overrun, signal restart and wait readers ready
                this.resetWriter(RING_HEADER_SIZE);
                await this.header.setWriterOffset(BigInt(RING_HEADER_SIZE));
                logger.debug(`writer: batch restart need ${chunk.length - availableSize} bytes more`);
                this.writePost();
                await this.readersLock.waitAsync();
                const sems = await this.header.acquireMultiple(['size', 'readerReady']);
                this.header._setValue('size', BigInt(0));
                this.header._setValue('readerReady', BigInt(0));
                sems.map(sem => sem.post());
            }

            // Directly write to the shared memory Buffer at the correct offset
            chunk.copy(this.shmBuffer.buffer, this.writeOffset);
            logger.debug(`writer: offset: ${this.writeOffset} wrote ${new TextDecoder().decode(chunk)}`);
            this.writeOffset += chunk.length;

            // Update header writer state attributes
            const sems = await this.header.acquireMultiple(['writerOffset', 'size']);

            this.header._setValue('writerOffset', BigInt(this.writeOffset));

            const size = this.header._getValue('size') + BigInt(chunk.length);
            this.header._setValue('size', size);

            sems.map(sem => sem.post());

            // Finally wake up readers
            this.writePost();

            callback();
        } catch (error) {
            callback(error instanceof Error ? error : new Error(`Unknown error: ${error}`));
        }
    }
}

export class RingBufferStreamReader extends SharedBufferReadStream {

    private readonly header: RingBufferHeader;
    private readonly writeLock: AsyncPosixSemaphore;
    private readonly readersLock: AsyncPosixSemaphore;

    constructor(
        key: number,
        size: number,
        options?: ReadableOptions,
        bufferOptions?: BufferOptions
    ) {
        super(key, size + RING_HEADER_SIZE, options, bufferOptions);
        this.resetReader(RING_HEADER_SIZE);

        this.header = new RingBufferHeader(
            this.shmBuffer.buffer, String(key),
            {create: true, existOk: true}
        );
        this.writeLock = new AsyncPosixSemaphore(
            `ring.${key}.write`,
            {create: true, existOk: true}
        );
        this.readersLock = new AsyncPosixSemaphore(
            `ring.${key}.readers`,
            {create: true, existOk: true}
        );
    }

    async init() {
        const sems = await this.header.acquireMultiple(['headerStr', 'readerCount']);
        if (!(this.header._getSequence('headerStr').toString() === RINGBUF_HEADER_STR))
            throw new Error(`RingBuffer header not passing magic string check`);

        const count = this.header._getValue('readerCount') + BigInt(1);

        this.header._setValue('readerCount', count);
        sems.map(sem => sem.post());

        logger.debug(`reader init: count: ${count}`);
    }

    async deinit() {
        await this.header.decrementReaderCount();
        await this.header.close();
        this.writeLock.close();
        this.readersLock.close();
        await this.writeLock.stop();
        await this.readersLock.stop();
        this.detach();

        logger.debug('reader deinit');
    }

    private async _maybeReadRest() {
        // read rest of buffer up to size indicated in header
        const endOffset = parseInt((await this.header.getSize()).toString()) + RING_HEADER_SIZE;
        const remainingSize = endOffset - this.readOffset;
        if (remainingSize > 0) {
            const data = this.shmBuffer.read(remainingSize, this.readOffset);
            this.push(data);
            this.readOffset += remainingSize;
        }
        logger.debug(`reader read remainder: ${remainingSize}`);
    }

    async _read(size: number): Promise<void> {
        try {
            await this.header.incrementReaderWaiting();
            await this.writeLock.waitAsync();
            const readersWaiting = await this.header.decrementReaderWaiting();

            if (readersWaiting == BigInt(0))
                this.writeLock.post();

            let writerOffset = parseInt((await this.header.getWriterOffset()).toString());
            let writerDistance = writerOffset - this.readOffset;

            const isNewDataAvailable = writerDistance != 0;

            if (!isNewDataAvailable)
                throw new Error(`reader unblocked but no new data to read?`);

            const isWriterSignalingBatchRestart = writerDistance < 0;

            if (isWriterSignalingBatchRestart) {
                logger.debug(`reader: writer started new batch`);
                await this._maybeReadRest();

                const readerSems = await this.header.acquireMultiple(['readerCount', 'readerReady']);
                const count = this.header._getValue('readerCount');
                const ready = this.header._getValue('readerReady') + BigInt(1);
                this.header._setValue('readerReady', ready);
                readerSems.map(sem => sem.post());
                this.resetReader(RING_HEADER_SIZE);

                // if we are last reader, post to readersLock to unblock writer
                if (ready == count)
                    this.readersLock.post();

                logger.debug(`reader prepared for new batch, last?: ${ready == count}`);
            } else {
                const readSize = Math.min(size, writerDistance);
                const data = this.shmBuffer.read(readSize, this.readOffset);
                this.push(data);
                logger.debug(`reader: offset: ${this.readOffset}, read: ${new TextDecoder().decode(data)}`);
                this.readOffset += readSize;
            }

        } catch (error) {
            this.emit('error', error instanceof Error ? error : new Error(`Unknown error: ${error}`));
        }
    }
}