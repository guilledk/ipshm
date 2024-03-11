import { expect } from 'chai';

import {RingBufferStreamReader, RingBufferStreamWriter} from '../ringbuf.js';
import {maybeDeleteSharedBuffer} from "../shbuf.js";
import {maybeDeleteSemaphore} from "../semaphore.js";
import {sleep} from "../utils.js";


async function readFromRingBuffer(reader: RingBufferStreamReader, readSize: number) {
    return await new Promise<string>((resolve, reject) => {
        let data = '';
        reader.on('data', (chunk) => {
            data += chunk.toString();
            if (data.length >= readSize)
                resolve(data.substring(0, readSize));
        });
        reader.on('end', () => {
            resolve(data);
        });
        reader.on('error', (error) => {
            reject(error);
        });
    });
}

describe('RingBuffer IPC Tests', function() {
    this.timeout(100000);

    const key = 0x420420;

    beforeEach(async () => {
        maybeDeleteSharedBuffer(key);
        maybeDeleteSemaphore(`${key}_headerStr`);
        maybeDeleteSemaphore(`${key}_writerOffset`);
        maybeDeleteSemaphore(`${key}_size`);
        maybeDeleteSemaphore(`${key}_readerCount`);
        maybeDeleteSemaphore(`${key}_readerWaiting`);
        maybeDeleteSemaphore(`${key}_readerReady`);
        maybeDeleteSemaphore(`ring.${key}.batch`);
        maybeDeleteSemaphore(`ring.${key}.write`);
        maybeDeleteSemaphore(`ring.${key}.write.sync`);
        maybeDeleteSemaphore(`ring.${key}.readers`);
    });

    it('should correctly handle wraparound and semaphore signaling with large data', async function() {
        // const word = 'with this prayer i free myself from my js chains';
        const word = '1234567890';
        const size = word.length * 2;

        const totalWords = 10;
        const words = Array(totalWords).fill(word);
        const wordText = words.join('');

        const writer = new RingBufferStreamWriter(key, size);
        const reader = new RingBufferStreamReader(key, size);

        // init writer and write one row
        await writer.init();
        await writer.writeAsync(word);

        await reader.init();

        const readerPromise = readFromRingBuffer(reader, wordText.length);
        await sleep(50);  // give reader time to start

        // write rest of text
        for (let i = 0; i < (totalWords - 1); i++)
            await writer.writeAsync(word);

        const readerText = await readerPromise;

        expect(readerText).to.be.equal(wordText);
    });
});
