import workerpool from "workerpool";
import ref from 'ref-napi';
import path from "node:path";
import {fileURLToPath} from "node:url";

import shmLibc from "./libc.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const O_CREAT = 0o100;
export const O_EXCL = 0o200;

export interface SemaphoreOptions {
    initialValue?: number;
    create?: boolean;
    existOk?: boolean;
    permissions?: number;
};

export class PosixSemaphore {
    readonly semName: string;
    readonly options: SemaphoreOptions;

    private readonly semPtr: any;

    constructor(semName: string, options: SemaphoreOptions) {
        this.semName = semName;

        options.initialValue = options.initialValue ?? 1;
        options.create = options.create ?? true;
        options.existOk = options.existOk ?? true;
        options.permissions = options.permissions ?? 0o666;

        this.options = options;

        let flags = 0;

        if (options.create) {
            flags |= O_CREAT;

            if (!options.existOk)
                flags |= O_EXCL;
        }

        this.semPtr = shmLibc.sem_open(semName, flags, options.permissions, options.initialValue);

        // Check if sem_open failed
        if (this.semPtr.isNull() || ref.address(this.semPtr) === 0xFFFFFFFF)
            throw new Error('Failed to open semaphore');
    }

    public wait(): void {
        const result = shmLibc.sem_wait(this.semPtr);
        if (result !== 0) {
            throw new Error('Failed to wait on semaphore');
        }
    }

    public post(): void {
        const result = shmLibc.sem_post(this.semPtr);
        if (result !== 0) {
            throw new Error('Failed to post semaphore');
        }
    }

    public close(): void {
        const result = shmLibc.sem_close(this.semPtr);
        if (result !== 0) {
            throw new Error('Failed to close semaphore');
        }
    }

    public unlink(): void {
        const result = shmLibc.sem_unlink(this.semName);
        if (result !== 0) {
            throw new Error('Failed to unlink semaphore');
        }
    }
}

export class AsyncPosixSemaphore extends PosixSemaphore {

    private asyncPosixSem: any;

    constructor(semName: string, options: SemaphoreOptions) {
        super(semName, options);

        this.asyncPosixSem = workerpool.pool(
            path.join(currentDir, 'workers/semaphore.js'),
            {minWorkers: 2, maxWorkers: 2}
        );
    }

    public async waitAsync(): Promise<void> {
        await this.asyncPosixSem.exec('semProxyCall', ['wait', this.semName, this.options.initialValue]);
    }

    public async closeAsync(): Promise<void> {
        await this.asyncPosixSem.exec('semProxyCall', ['close', this.semName, this.options.initialValue]);
    }

    public async unlinkAsync(): Promise<void> {
        await this.asyncPosixSem.exec('semProxyCall', ['unlink', this.semName, this.options.initialValue]);
    }

    public async stop(): Promise<void> {
        await this.asyncPosixSem.terminate();
    }
}
