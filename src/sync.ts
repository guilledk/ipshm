import {AsyncPosixSemaphore, SemaphoreOptions} from "./semaphore.js";

export interface FieldConfig {
    [key: string]: {
        offset: number;
        size: number;
    }
}

export class FieldManager {
    private readonly buffer: Buffer;
    private readonly config: FieldConfig;
    private readonly prefix: string;

    private semaphores: Map<string, AsyncPosixSemaphore>;
    private readonly semOptions: SemaphoreOptions;

    constructor(buffer: Buffer, config: FieldConfig, prefix: string, semOptions?: SemaphoreOptions) {
        this.buffer = buffer;
        this.config = config;
        this.prefix = prefix;

        this.semaphores = new Map();

        this.semOptions = semOptions ?? {create: true, existOk: true, initialValue: 1};

        // Initialize semaphore for each config field
        Object.keys(this.config).forEach((key: string) => {
            this.getSemaphoreForKey(key);
        });
    }

    private getSemaphoreForKey(key: string): AsyncPosixSemaphore {
        if (!this.semaphores.has(key)) {
            const semaphoreName = `${this.prefix}_${key}`;
            const semaphore = new AsyncPosixSemaphore(semaphoreName, this.semOptions);
            this.semaphores.set(key, semaphore);
        }
        return this.semaphores.get(key)!; // Non-null assertion since we know it exists
    }

    async acquire(fieldName: string): Promise<AsyncPosixSemaphore> {
        if (!(fieldName in this.config))
            throw new Error(`Field ${fieldName} not found in configuration`);

        const semaphore = this.getSemaphoreForKey(fieldName);
        await semaphore.waitAsync();
        return semaphore;
    }

    async acquireMultiple(fields: string[]): Promise<AsyncPosixSemaphore[]> {
        const sems = [];
        const taskFn = async (field: string) => {
            sems.push(await this.acquire(field));
        };
        await Promise.all(fields.map(field => taskFn(field)));
        return sems;
    }

    _getValue(fieldName: string): bigint {
        return this.buffer.readBigUInt64LE(this.config[fieldName].offset);
    }

    _setValue(fieldName: string, value: bigint) {
        return this.buffer.writeBigUInt64LE(value, this.config[fieldName].offset);
    }

    _getSequence(fieldName: string): Buffer {
        const config = this.config[fieldName];
        return this.buffer.subarray(config.offset, config.offset + config.size);
    }

    _setSequence(fieldName: string, sequence: Buffer) {
        const config = this.config[fieldName];
        if (config.size != sequence.length)
            throw new Error('Provided sequence size does not match field config');

        sequence.copy(this.buffer, config.offset);
    }

    async getValue(fieldName: string): Promise<bigint> {
        const semaphore = await this.acquire(fieldName);
        const value = this._getValue(fieldName);
        semaphore.post();
        return value;
    }

    async getSequence(fieldName: string): Promise<Buffer> {
        const semaphore = await this.acquire(fieldName);
        const value = this._getSequence(fieldName);
        semaphore.post();
        return value;
    }

    async setValue(fieldName: string, value: bigint) {
        const semaphore = await this.acquire(fieldName);
        this._setValue(fieldName, value);
        semaphore.post();
    }

    async setSequence(fieldName: string, sequence: Buffer): Promise<void> {
        if (this.config[fieldName].size != sequence.length)
            throw new Error('Provided sequence size does not match field config');

        const semaphore = await this.acquire(fieldName);
        this._setSequence(fieldName, sequence)
        semaphore.post();
    }

    async close(unlink: boolean = false) {
        for (const semaphore of this.semaphores.values()) {
            await semaphore.closeAsync();
            if (unlink)
                await semaphore.unlinkAsync();
        }
    }
}