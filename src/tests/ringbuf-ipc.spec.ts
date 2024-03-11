import { expect } from 'chai';
import workerpool from 'workerpool';

import { RingBufferStreamWriter } from '../ringbuf.js';
import {maybeDeleteSharedBuffer} from "../shbuf.js";
import {maybeDeleteSemaphore} from "../semaphore.js";


async function readFromRingBuffer(key: number, size: number, readSize: number) {
    // @ts-ignore
    const { RingBufferStreamReader } = await import('../../../build/ringbuf.js');
    const reader = new RingBufferStreamReader(key, size);
    await reader.init();
    let data = '';
    await new Promise<void>((resolve, reject) => {
        let data = '';
        reader.on('data', (chunk) => {
            data += chunk.toString();
            if (data.length >= readSize) {
                data = data.substring(0, readSize);
                resolve();
            }
        });
        reader.on('end', () => {
            resolve();
        });
        reader.on('error', (error) => {
            reject(error);
        });
    });

    await reader.deinit();
    return data;
}

describe('RingBuffer IPC Tests', function() {
    this.timeout(100000);

    const key = 123456;
    const size = 14 * 2;

    let pool;
    let writer: RingBufferStreamWriter;

    before(async () => {
        maybeDeleteSharedBuffer(key);
        maybeDeleteSemaphore(`${key}_headerStr`);
        maybeDeleteSemaphore(`${key}_writerOffset`);
        maybeDeleteSemaphore(`${key}_size`);
        maybeDeleteSemaphore(`${key}_readerCount`);
        maybeDeleteSemaphore(`${key}_readerReady`);
        maybeDeleteSemaphore(`ring.${key}.batch`);
        maybeDeleteSemaphore(`ring.${key}.write`);
        maybeDeleteSemaphore(`ring.${key}.readers`);
        pool = workerpool.pool({ workerType: 'process' });
        writer = new RingBufferStreamWriter(key, size);
        await writer.init();
    });

    after(async () => {
        await pool.terminate(true);
        await writer.deinit();
    });

    it('should correctly handle wraparound and semaphore signaling with large data', async function() {
        const stringChunks = Array(3).fill('Hello, world! ');
        const testString = stringChunks.join();

        // Write data to the ring buffer in chunks to simulate streaming
        setTimeout(async () => {
            for (const chunk of stringChunks)
                await writer.writeAsync(Buffer.from(chunk));
            writer.end();
        }, 0);

        // Start reading in a background process
        const readStr = await pool.exec(readFromRingBuffer, [key, size, testString.length]);

        expect(readStr).to.be.equal(testString);
    });
});
