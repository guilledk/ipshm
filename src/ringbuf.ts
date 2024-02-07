import { FieldManager, FieldConfig } from './sync.js';
import {AsyncPosixSemaphore, SemaphoreOptions} from "./semaphore.js";

export const RINGBUF_HEADER_STR = 'RING1';

export const headerConfig: FieldConfig = {
    headerStr: {
        offset: 0,
        size: RINGBUF_HEADER_STR.length,
    },
    writerOffset: {
        offset: RINGBUF_HEADER_STR.length + 8,
        size: 8,
    },
    batchId: {
        offset: RINGBUF_HEADER_STR.length + 16,
        size: 8,
    },
    readerCount: {
        offset: RINGBUF_HEADER_STR.length + 24,
        size: 8,
    },
    readerReady: {
        offset: RINGBUF_HEADER_STR.length + 32,
        size: 8,
    }
};


export class RingBufferHeader {
    private fieldManager: FieldManager;
    readonly prefix: string;

    constructor(buffer: Buffer, prefix: string, semOptions?: SemaphoreOptions) {
        this.prefix = prefix;
        this.fieldManager = new FieldManager(buffer, headerConfig, prefix, semOptions);
    }

    async initializeHeader(): Promise<void> {
        const sems: AsyncPosixSemaphore[] = await this.fieldManager.acquireMultiple(
        ['headerStr', 'writerOffset', 'batchId', 'readerCount', 'readerReady']);

        this.fieldManager._setSequence('headerStr', Buffer.from(new TextEncoder().encode(RINGBUF_HEADER_STR)));
        this.fieldManager._setValue('writerOffset', BigInt(0));
        this.fieldManager._setValue('batchId',      BigInt(0));
        this.fieldManager._setValue('readerCount',  BigInt(0));
        this.fieldManager._setValue('readerReady',  BigInt(0));
        sems.forEach(s => s.post());
    }

    async checkMagicString(): Promise<boolean> {
        const seq = await this.fieldManager.getSequence('headerStr');
        return new TextDecoder('utf-8').decode(seq) === RINGBUF_HEADER_STR;
    }

    async getWriterOffset(): Promise<bigint> {
        return await this.fieldManager.getValue('writerOffset');
    }

    async setWriterOffset(value: bigint) {
        await this.fieldManager.setValue('writerOffset', value);
    }

    async getBatchId(): Promise<bigint> {
        return await this.fieldManager.getValue('batchId')
    }

    async incrementBatchId() {
        const sem = await this.fieldManager.acquire('batchId');
        const batchId = this.fieldManager._getValue('batchId');
        this.fieldManager._setValue('batchId', batchId + BigInt(1));
        sem.post();
    }

    async incrementReaderCount() {
        const sem = await this.fieldManager.acquire('readerCount');
        const readerCount = this.fieldManager._getValue('readerCount');
        this.fieldManager._setValue('readerCount', readerCount + BigInt(1));
        sem.post();
    }

    async incrementReaderReady() {
        const sem = await this.fieldManager.acquire('readerReady');
        const readerReady = this.fieldManager._getValue('readerReady');
        this.fieldManager._setValue('readerReady', readerReady + BigInt(1));
        sem.post();
    }

    async decrementReaderCount() {
        const sem = await this.fieldManager.acquire('readerCount');
        const readerCount = this.fieldManager._getValue('readerCount');
        this.fieldManager._setValue('readerCount', readerCount - BigInt(1));
        sem.post();
    }

    async decrementReaderReady() {
        const sem = await this.fieldManager.acquire('readerReady');
        const readerReady = this.fieldManager._getValue('readerReady');
        this.fieldManager._setValue('readerReady', readerReady - BigInt(1));
        sem.post();
    }

    async areReadersReady(): Promise<boolean> {
        const sems = await this.fieldManager.acquireMultiple(['readerCount', 'readerReady']);
        const areReady = (
            this.fieldManager._getValue('readerCount') == this.fieldManager._getValue('readerReady')
        );
        sems.forEach(sem => sem.post());
        return areReady;
    }
}