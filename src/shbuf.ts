import {libc, isErrorVoidPtr} from "./libc.js";
import ref from "ref-napi";

export const IPC_CREAT = 0o1000;   /* create if key is nonexistent */
export const IPC_EXCL = 0o2000;   /* fail if key exists */
export const IPC_RMID = 0;   /* remove buffer */

export interface BufferOptions {
    create?: boolean;
    existOk?: boolean;
    permissions?: number;

    offset?: number;
}

export class SharedBuffer {
    readonly key: number;
    readonly size: number;
    readonly options: BufferOptions;

    readonly id: number;
    readonly ptr: any;
    readonly buffer: Buffer;

    constructor(key: number, size: number, options: BufferOptions = {}) {
        this.key = key;
        this.size = size;

        options.create = options.create ?? true;
        options.existOk = options.existOk ?? true;
        options.permissions = options.permissions ?? 0o664;
        options.offset = options.offset ?? 0;

        this.options = options;

        let flags = 0;

        if (options.create) {
            flags |= IPC_CREAT;

            if (!options.existOk)
                flags |= IPC_EXCL;

            flags |= options.permissions;
        }

        this.id = libc.shmget(key, size, flags);
        if (this.id < 0)
            throw new Error('Failed to create shared memory segment');

        this.ptr = libc.shmat(this.id, null, 0);
        if (this.ptr.isNull() || isErrorVoidPtr(this.ptr))
            throw new Error('Failed to attach shared memory segment');

        this.buffer = ref.reinterpret(this.ptr, size, options.offset);
    }

    write(data: Buffer, offset: number = 0): void {
        data.copy(this.buffer, offset);
    }

    read(length: number, offset: number = 0): Buffer {
        return Buffer.from(ref.reinterpret(this.buffer, length, offset));
    }

    remove() {
        const result = libc.shmctl(this.id, IPC_RMID, null);
        if (result < 0)
            throw new Error(`Failed to remove shared memory segment with key ${this.key}.`);
    }

    detach() {
        libc.shmdt(this.ptr);
    }
}

export function maybeDeleteSharedBuffer(key: number): void {
    const shmId = libc.shmget(key, 0, 0);
    if (shmId < 0)
        return;

    // Remove the shared memory segment
    const result = libc.shmctl(shmId, IPC_RMID, null);
    if (result < 0)
        return;

    console.log(`Shared buffer with key ${key} has been successfully removed.`);
}
