import ref from 'ref-napi';
import {Readable, Writable} from 'stream';

import shmLibc from "./libc.js";
import {sleep} from "./utils.js";
import {AsyncPosixSemaphore} from "./semaphore.js";

export const IPS_MAGIC_STRING = 'INTER-PROC-SHARED1';
export const IPS_HEADER_SIZE = IPS_MAGIC_STRING.length + 8 + 8 + 8;

class IPSHeaderManager {
    private buffer: Buffer;
    readonly prefix: string;
    readonly magicString: string;
    private semaphores: Map<string, AsyncPosixSemaphore>; // Changed to use a map of AsyncPosixSemaphore

    constructor(buffer: Buffer, prefix: string) {
        this.buffer = buffer;
        this.prefix = prefix;
        this.magicString = IPS_MAGIC_STRING;
        this.semaphores = new Map(); // Initialize the semaphore map
    }

    // Helper function to get or create a semaphore for a given key
    private getSemaphoreForKey(key: string): AsyncPosixSemaphore {
        if (!this.semaphores.has(key)) {
            const semaphoreName = `${this.prefix}_sem_${key}`;
            const semaphore = new AsyncPosixSemaphore(semaphoreName, {initialValue: 1});
            this.semaphores.set(key, semaphore);
        }
        return this.semaphores.get(key);
    }

    async initializeHeader(): Promise<void> {
        const semaphore = this.getSemaphoreForKey('header');
        await semaphore.waitAsync();
        this.buffer.write(this.magicString, 0, this.magicString.length, 'utf-8');
        this.buffer.writeBigUInt64LE(BigInt(IPS_HEADER_SIZE), this.magicString.length);
        this.buffer.writeBigUInt64LE(BigInt(0), this.magicString.length + 8);
        this.buffer.writeBigUInt64LE(BigInt(0), this.magicString.length + 16);
        this.buffer.writeBigUInt64LE(BigInt(0), this.magicString.length + 24);
        semaphore.post();
    }

    async checkMagicString(): Promise<boolean> {
        const semaphore = this.getSemaphoreForKey('magic_string');
        await semaphore.waitAsync();
        const magicStringFromBuffer = this.buffer.toString('utf-8', 0, this.magicString.length);
        semaphore.post();
        return magicStringFromBuffer === this.magicString;
    }

    async getWriterOffset(): Promise<bigint> {
        const semaphore = this.getSemaphoreForKey('writer_offset');
        await semaphore.waitAsync();
        const offset = this.buffer.readBigUInt64LE(this.magicString.length);
        semaphore.post();
        return offset;
    }

    async setWriterOffset(value: bigint) {
        const semaphore = this.getSemaphoreForKey('writer_offset');
        await semaphore.waitAsync();
        this.buffer.writeBigUInt64LE(value, this.magicString.length);
        semaphore.post();
    }

    async getBatchId(): Promise<bigint> {
        const semaphore = this.getSemaphoreForKey('batch_id');
        await semaphore.waitAsync();
        const bid = this.buffer.readBigUInt64LE(this.magicString.length + 24);
        semaphore.post();
        return bid;
    }

    async incrementBatchId() {
        const semaphore = this.getSemaphoreForKey('batch_id');
        await semaphore.waitAsync();
        const bid = this.buffer.readBigUInt64LE(this.magicString.length + 24) + BigInt(1);
        this.buffer.writeBigUInt64LE(bid, this.magicString.length + 24);
        semaphore.post();
    }

    async getReaderCount(): Promise<bigint> {
        const semaphore = this.getSemaphoreForKey('reader_count');
        await semaphore.waitAsync();
        const count = this.buffer.readBigUInt64LE(this.magicString.length + 8);
        semaphore.post();
        return count;
    }

    async getReaderReady(): Promise<bigint> {
        const semaphore = this.getSemaphoreForKey('reader_ready');
        await semaphore.waitAsync();
        const ready = this.buffer.readBigUInt64LE(this.magicString.length + 16);
        semaphore.post();
        return ready;
    }

    async incrementReaderCount() {
        const semaphore = this.getSemaphoreForKey('reader_count');
        await semaphore.waitAsync();
        const count = this.buffer.readBigUInt64LE(this.magicString.length + 8) + BigInt(1);
        this.buffer.writeBigUInt64LE(count, this.magicString.length + 8);
        semaphore.post();
    }

    async incrementReaderReady() {
        const semaphore = this.getSemaphoreForKey('reader_ready');
        await semaphore.waitAsync();
        const ready = this.buffer.readBigUInt64LE(this.magicString.length + 16) + BigInt(1);
        this.buffer.writeBigUInt64LE(ready, this.magicString.length + 16);
        semaphore.post();
    }

    async decrementReaderCount() {
        const semaphore = this.getSemaphoreForKey('reader_count');
        await semaphore.waitAsync();
        const count = this.buffer.readBigUInt64LE(this.magicString.length + 8) - BigInt(1);
        this.buffer.writeBigUInt64LE(count, this.magicString.length + 8);
        semaphore.post();
    }

    async decrementReaderReady() {
        const semaphore = this.getSemaphoreForKey('reader_ready');
        await semaphore.waitAsync();
        const ready = this.buffer.readBigUInt64LE(this.magicString.length + 16) - BigInt(1);
        this.buffer.writeBigUInt64LE(ready, this.magicString.length + 16);
        semaphore.post();
    }

    async areReadersReady(): Promise<boolean> {
        const semaphoreCount = this.getSemaphoreForKey('reader_count');
        const semaphoreReady = this.getSemaphoreForKey('reader_ready');
        await semaphoreCount.waitAsync();
        await semaphoreReady.waitAsync();
        const total = this.buffer.readBigUInt64LE(this.magicString.length + 8);
        const ready = this.buffer.readBigUInt64LE(this.magicString.length + 16);
        semaphoreCount.post(); semaphoreReady.post();
        return total == ready;
    }
}

export const IPC_RMID = 0; // Command to remove shared memory segment

export function maybeDeleteSharedMemorySegment(key: number): void {
    const shmId = shmLibc.shmget(key, 0, 0);
    if (shmId < 0)
        return;

    // Remove the shared memory segment
    const result = shmLibc.shmctl(shmId, IPC_RMID, null);
    if (result < 0)
        return;

    console.log(`Shared memory segment with key ${key} has been successfully removed.`);
}

export const IPC_CREAT = 0o1000;   /* create if key is nonexistent */
export const IPC_EXCL = 0o2000;   /* fail if key exists */

export const WRITER_PERMS = 0o664;

export class IPSharedMemoryWriter extends Writable {

    readonly key: number;
    readonly size: number;
    readonly shmId: number;
    private readonly sharedPtr: any;
    private readonly sharedMemory: Buffer;

    private writeOffset: number;

    private header: IPSHeaderManager;
    private _batchId: bigint;

    constructor(key: number, size: number, options?: any) {
        super(options);
        this.key = key;
        this.size = size + IPS_HEADER_SIZE;
        this.shmId = shmLibc.shmget(key, this.size, IPC_CREAT | IPC_EXCL | WRITER_PERMS);
        if (this.shmId < 0) {
            throw new Error('Failed to create shared memory segment');
        }

        const shmAddr = shmLibc.shmat(this.shmId, null, 0);
        if (shmAddr.isNull()) {
            throw new Error('Failed to attach shared memory segment');
        }
        this.sharedPtr = shmAddr;
        this.sharedMemory = ref.reinterpret(shmAddr, this.size, 0);
    }

    async init() {
        this.header = new IPSHeaderManager(this.sharedMemory, `ips_${this.key}`);
        await this.header.initializeHeader();

        this._batchId = BigInt(0);
        await this._updateHeader(this._batchId);
    }

    async _updateHeader(targetBatch: bigint) {
        if (targetBatch > this._batchId) {
            await this.header.setWriterOffset(BigInt(IPS_HEADER_SIZE));
            await this.header.incrementBatchId();
        } else
            await this.header.setWriterOffset(BigInt(this.writeOffset));

        this._batchId = targetBatch;
    }

    _write(chunk: Buffer, encoding: string, callback: (error?: Error | null) => void): void {
        try {
            if (!Buffer.isBuffer(chunk))
                throw new Error('Chunk must be a Buffer');

            const availableSize = this.size - this.writeOffset;
            if (chunk.length > availableSize)
                throw new Error(`Chunk larger than available memory!`);

            // Directly write to the shared memory Buffer at the correct offset
            chunk.copy(this.sharedMemory, this.writeOffset);
            this.writeOffset += chunk.length;

            callback();
        } catch (error) {
            callback(error instanceof Error ? error : new Error(`Unknown error: ${error}`));
        }
    }

    get currentOffset(): number {
        return this.writeOffset;
    }

    async resetWriter(): Promise<void> {
        this.writeOffset = IPS_HEADER_SIZE;
        await this._updateHeader(this._batchId + BigInt(1));
    }

    async writeAsync(chunk: any, encoding: string = 'utf-8'): Promise<void> {
        return new Promise((resolve, reject) => {
            // @ts-ignore
            this.write(chunk, encoding, async (error) => {
                if (error) {
                    reject(error);
                } else {
                    if (this.writeOffset == this.size) {
                        while (!(await this.header.areReadersReady()))
                            await sleep(100);

                        await this.resetWriter();
                    } else
                        await this._updateHeader(this._batchId);

                    resolve();
                }
            });
        });
    }

    remove() {
        const result = shmLibc.shmctl(this.shmId, IPC_RMID, null);
        if (result < 0) {
            throw new Error(`Failed to remove shared memory segment with key ${this.key}.`);
        }
    }

    detach() {
        shmLibc.shmdt(this.sharedPtr);
    }
}

export class IPSharedMemoryReader extends Readable {

    readonly key: number;
    readonly size: number;
    readonly shmId: number;
    readonly sharedMemory: any;

    private readOffset: number;

    private header: IPSHeaderManager;
    private _batchId: bigint;
    private _ready: boolean;

    constructor(key: number, size: number, options?: any) {
        super(options);
        this.key = key;
        this.size = size + IPS_HEADER_SIZE;

        // Attempt to access existing shared memory segment
        this.shmId = shmLibc.shmget(key, this.size, 0); // 0 flag for no creation
        if (this.shmId < 0) {
            throw new Error(`Failed to access shared memory segment with key ${key}`);
        }

        // Attach to the shared memory segment
        this.sharedMemory = shmLibc.shmat(this.shmId, null, 0);
        if (this.sharedMemory.isNull()) {
            throw new Error('Failed to attach to shared memory segment');
        }
    }

    async init() {
        this.header = new IPSHeaderManager(this.sharedMemory, `ips_${this.key}`);
        if (!(await this.header.checkMagicString()))
            throw new Error('Magic string check failed!');

        this.readOffset = IPS_HEADER_SIZE;
        this._batchId = await this.header.getBatchId();
        await this.header.incrementReaderCount();
    }

    private async _incrementReady() {
        if (this._ready)
            return;

        await this.header.incrementReaderReady();
        this._ready = true;
    }

    private async _decrementReady() {
        if (!this._ready)
            return;

        await this.header.decrementReaderReady();
        this._ready = false;
    }

    private async _updateHeader() {
        const batchId = await this.header.getBatchId();
        const batchDelta = batchId - this._batchId;
        const writerOffset = await this.header.getWriterOffset();
        if (batchDelta > BigInt(0)) {
            // writer has moved on to another batch

            // if we have reached the end
            if (this.readOffset == this.size) {
                this.readOffset = IPS_HEADER_SIZE;
            }
        }

        // if we have same offset we have no new data to read
        if (writerOffset == BigInt(this.readOffset))
            await this._incrementReady();
        else
            await this._decrementReady();

        this._batchId = batchId;
    }

    _read(size: number): void {
        try {
            const remainingSize = this.size - this.readOffset;
            if (remainingSize <= 0)
                return;

            const readSize = Math.min(size, remainingSize);
            const data = Buffer.from(ref.reinterpret(this.sharedMemory, readSize, this.readOffset));
            this.readOffset += readSize;

            this._updateHeader().then(() => this.push(data));
        } catch (error) {
            this.emit('error', error instanceof Error ? error : new Error(`Unknown error: ${error}`));
        }
    }

    async resetReader() {
        this.readOffset = IPS_HEADER_SIZE;
        await this._updateHeader();
    }

    detach() {
        shmLibc.shmdt(this.sharedMemory);
    }
}
