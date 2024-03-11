import workerpool from "workerpool";
import ref from 'ref-napi';

import path from "node:path";

import {libc} from "./libc.js";
import {BUILD_DIR} from "./utils.js";


export const O_CREAT = 0o100;
export const O_EXCL = 0o200;

export interface SemaphoreOptions {
    initialValue?: number;
    create?: boolean;
    existOk?: boolean;
    permissions?: number;
}

export function getSemPointer(semName: string, options?: SemaphoreOptions) {
    options.initialValue = options.initialValue ?? 1;
    options.create = options.create ?? true;
    options.existOk = options.existOk ?? true;
    options.permissions = options.permissions ?? 0o666;

    let flags = 0;

    if (options.create) {
        flags |= O_CREAT;

        if (!options.existOk)
            flags |= O_EXCL;
    }

    const semPtr = libc.sem_open(semName, flags, options.permissions, options.initialValue);

    // Check if sem_open failed
    if (semPtr.isNull() || ref.address(semPtr) === 0xFFFFFFFF)
        throw new Error(`Failed to open semaphore named ${semName}`);

    return semPtr;
}

export class PosixSemaphore {
    readonly semName: string;
    readonly options: SemaphoreOptions = {};

    private readonly semPtr: any;

    constructor(semName: string, options?: SemaphoreOptions) {
        this.semName = semName;

        this.options.initialValue = options.initialValue ?? 1;
        this.options.create = options.create ?? true;
        this.options.existOk = options.existOk ?? true;
        this.options.permissions = options.permissions ?? 0o666;

        this.semPtr = getSemPointer(semName, this.options);
    }

    wait(): void {
        const result = libc.sem_wait(this.semPtr);
        if (result !== 0) {
            throw new Error('Failed to wait on semaphore');
        }
    }

    getvalue(): number {
        const valuePtr = ref.alloc('int');
        const result = libc.sem_getvalue(this.semPtr, valuePtr);

        if (result === 0) {
            return valuePtr.deref();
        } else {
            const error = new Error(`Failed to get semaphore value, errno: ${result}`);
            throw error;
        }
    }

    post(): void {
        const result = libc.sem_post(this.semPtr);
        if (result !== 0) {
            throw new Error('Failed to post semaphore');
        }
    }

    close(): void {
        const result = libc.sem_close(this.semPtr);
        if (result !== 0) {
            throw new Error('Failed to close semaphore');
        }
    }

    unlink(): void {
        const result = libc.sem_unlink(this.semName);
        if (result !== 0) {
            throw new Error('Failed to unlink semaphore');
        }
    }
}

export class AsyncPosixSemaphore extends PosixSemaphore {
    private _semWorker: any;

    constructor(semName: string, options?: SemaphoreOptions) {
        super(semName, options);

        this._semWorker = workerpool.pool(
            path.join(BUILD_DIR, 'workers/semaphore.js'),
            {minWorkers: 1, maxWorkers: 1}
        );
    }

    private async _doAsync(call: string, ...params) {
        return await this._semWorker.exec(
            'semInWorker',
            [call, this.semName, ...params]
        );
    }

    public async waitAsync(sync: boolean = false): Promise<void> {
        await this._doAsync('wait', sync);
    }

    public async closeAsync(sync: boolean = false): Promise<void> {
        await this._doAsync('close', sync);
    }

    public async unlinkAsync(sync: boolean = false): Promise<void> {
        await this._doAsync('unlink', sync);
    }

    public async stop(): Promise<void> {
        await this._semWorker.terminate();
    }
}

export function maybeDeleteSemaphore(semName: string) {
    try {
        const sem = new PosixSemaphore(semName, {create: false});
        sem.unlink();
        console.log(`Unlinked semaphore ${semName}`);

    } catch (e) {
        if (!e.message.includes('Failed to open semaphore'))
            throw e;
    }
}