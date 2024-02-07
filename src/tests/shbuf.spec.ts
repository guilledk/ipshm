import {expect} from "chai";

import {maybeDeleteSharedBuffer, SharedBuffer} from "../shbuf.js";


async function readBufferInSubprocess(key: number, size: number, readSize: number, offset: number = 0): Promise<string> {
    // @ts-ignore
    const { SharedBuffer } = await import('../../build/shbuf.js');
    const buf = new SharedBuffer(key, size, {create: false});
    return new TextDecoder('utf-8').decode(buf.read(readSize, offset));
}

describe('SharedBuffer Module', function() {
    const key = 123456;
    const size = 128;

    before(function() {
        maybeDeleteSharedBuffer(key);
    });

    after(function() {
        maybeDeleteSharedBuffer(key);
    });

    it('should allow a child process to read data written by the parent process', async function() {
        const bufferOptions = {
            create: true,
            existOk: false, // Ensure we're testing a clean slate
            permissions: 0o666,
        };

        const sharedBuffer = new SharedBuffer(key, size, bufferOptions);

        // Write some data into the shared buffer from the parent process
        const testData = new TextEncoder().encode('Hello, shared memory!');
        sharedBuffer.write(Buffer.from(testData));

        const output = await readBufferInSubprocess(key, size, testData.length);

        expect(output).to.equal('Hello, shared memory!');

        sharedBuffer.detach();
        sharedBuffer.remove();
    });
});
