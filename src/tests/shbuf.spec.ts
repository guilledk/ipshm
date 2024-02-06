import {expect} from "chai";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {maybeDeleteSharedBuffer, SharedBuffer} from "../shbuf.js";
import {runCommand} from "../utils.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const helperScript = path.join(currentDir, 'shbuf.helper.js');

async function readBufferInSubprocess(key: number, size: number, readSize: number, offset: number = 0): Promise<string> {
    return await runCommand(
        'node', [helperScript, key.toString(), size.toString(), readSize.toString(), offset.toString()]);
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
