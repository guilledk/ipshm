import {Readable, ReadableOptions, Writable, WritableOptions} from 'stream';

import {BufferOptions, SharedBuffer} from "./shbuf.js";


export class SharedBufferWriteStream extends Writable {

    readonly key: number;
    readonly size: number;
    private readonly shmBuffer: SharedBuffer;
    readonly bufferOptions: BufferOptions;

    private writeOffset: number;

    constructor(key: number, size: number, options?: WritableOptions, bufferOptions?: BufferOptions) {
        super(options);
        this.key = key;
        this.size = size;

        this.bufferOptions = bufferOptions ?? {
            create: true,
            existOk: true,
            permissions: 0o644
        };

        this.shmBuffer = new SharedBuffer(key, size, this.bufferOptions);
    }

    _write(chunk: Buffer, encoding: string, callback: (error?: Error | null) => void): void {
        try {
            if (!Buffer.isBuffer(chunk))
                throw new Error('Chunk must be a Buffer');

            const availableSize = this.size - this.writeOffset;
            if (chunk.length > availableSize)
                throw new Error(`Chunk larger than available memory!`);

            // Directly write to the shared memory Buffer at the correct offset
            chunk.copy(this.shmBuffer.buffer, this.writeOffset);
            this.writeOffset += chunk.length;

            callback();
        } catch (error) {
            callback(error instanceof Error ? error : new Error(`Unknown error: ${error}`));
        }
    }

    get currentOffset(): number {
        return this.writeOffset;
    }

    resetWriter(offset: number = 0): void {
        this.writeOffset = offset;
    }

    async writeAsync(chunk: any, encoding: string = 'utf-8'): Promise<void> {
        return new Promise((resolve, reject) => {
            // @ts-ignore
            this.write(chunk, encoding, async (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    remove() { this.shmBuffer.remove(); }

    detach() { this.shmBuffer.detach(); }
}

export class SharedBufferReadStream extends Readable {

    readonly key: number;
    readonly size: number;
    readonly shmBuffer: SharedBuffer;
    readonly bufferOptions: BufferOptions;

    private readOffset: number;


    constructor(key: number, size: number, options?: ReadableOptions, bufferOptions?: BufferOptions) {
        super(options);
        this.key = key;
        this.size = size;

        this.bufferOptions = bufferOptions ?? {
            create: false
        };

        this.shmBuffer = new SharedBuffer(key, size, this.bufferOptions);

        this.resetReader();
    }

    _read(size: number): void {
        try {
            const remainingSize = this.size - this.readOffset;
            if (remainingSize <= 0) {
                this.push(null);
                return;
            }

            const readSize = Math.min(size, remainingSize);
            const data = this.shmBuffer.read(readSize, this.readOffset);
            this.push(data);
            this.readOffset += readSize;

        } catch (error) {
            this.emit('error', error instanceof Error ? error : new Error(`Unknown error: ${error}`));
        }
    }

    resetReader(offset: number = 0) {
        this.readOffset = offset;
    }

    detach() { this.shmBuffer.detach(); }
}