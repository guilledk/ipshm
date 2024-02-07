import { expect } from 'chai';
import workerpool from 'workerpool';
import {maybeDeleteSharedBuffer, SharedBuffer} from "../shbuf.js";

async function writeToSharedBuffer(key: number, size: number, data: string) {
    // @ts-ignore
    const { SharedBufferWriteStream } = await import('../../../build/stream.js');
    const writeStream = new SharedBufferWriteStream(key, size);
    await writeStream.writeAsync(data);
    writeStream.detach();
}

async function readFromSharedBuffer(key: number, size: number, readSize: number) {
    // @ts-ignore
    const { SharedBufferReadStream } = await import('../../../build/stream.js');
    const readStream = new SharedBufferReadStream(key, size);
    return new Promise<string>((resolve, reject) => {
        let data = '';
        readStream.on('data', (chunk) => {
            data += chunk.toString();
            if (data.length >= readSize) {
                data = data.substring(0, readSize);
                resolve(data);
            }
        });
        readStream.on('end', () => {
            resolve(data);
        });
        readStream.on('error', (error) => {
            reject(error);
        });
    });
}

describe('SharedBuffer Stream IPC Tests', function() {
    this.timeout(20000);

    const key = 123456;
    const size = 128;

    let pool;

    const bufferOptions = {
        create: true,
        existOk: false, // Ensure we're testing a clean slate
        permissions: 0o666,
    };
    let sharedBuffer: SharedBuffer;

    before(() => {
        pool = workerpool.pool({ workerType: 'process' });
        maybeDeleteSharedBuffer(key);
        sharedBuffer = new SharedBuffer(key, size, bufferOptions);
    });

    after(async () => {
        sharedBuffer.remove();
        sharedBuffer.detach();
        await pool.terminate(true);
    });

    it('should write to and read from a shared buffer across processes', async function() {
        const testString = 'Hello, world!';
        // Write to shared buffer in a separate process
        await pool.exec(writeToSharedBuffer, [key, size, testString]).catch((error) => {
            console.error(error);
            throw error;
        });

        // Read from shared buffer in a separate process
        const result = await pool.exec(readFromSharedBuffer, [key, size, testString.length]).catch((error) => {
            console.error(error);
            throw error;
        });

        // Assert that the read string matches the written string
        expect(result).to.equal(testString);
    });
});
