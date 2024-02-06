import {AsyncPosixSemaphore} from "./semaphore.js";

export const IPS_MAGIC_STRING = 'INTER-PROC-SHARED1';
export const IPS_HEADER_SIZE = IPS_MAGIC_STRING.length + 8 + 8 + 8;

export class IPSHeaderManager {
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
            const semaphore = new AsyncPosixSemaphore(
                semaphoreName, {create: true, existOk: false, initialValue: 1});
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
