import { expect } from 'chai';
import {execSync} from 'node:child_process';
import path from "node:path";
import {fileURLToPath} from "node:url";

import {IPS_HEADER_SIZE, IPSharedMemoryWriter, maybeDeleteSharedMemorySegment} from '../ipshm.js';
import {runCommand} from "../utils.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const ipcReader = path.join(currentDir, 'ipshm.helper.js');

async function readIPSBuff(key: number, size: number): Promise<string> {
    if (typeof key !== 'number' || typeof size !== 'number')
        throw new Error(`Expected ${key} & ${size} to be numbers!`);

    return await runCommand('node', [ipcReader, String(key), String(size)]);
}

describe('IPSharedMemoryStream', () => {
    const key = 123456; // Unique key for IPC
    const size = 1024; // Size of the shared memory segment
    let stream: IPSharedMemoryWriter;

    before(async () => {
        maybeDeleteSharedMemorySegment(key);
        stream = new IPSharedMemoryWriter(key, size);
        await stream.init();
    });

    beforeEach(async () => {
        await stream.resetWriter();
    })

    after(() => {
        stream?.remove();
        stream?.detach();

        maybeDeleteSharedMemorySegment(key);
    });

    it('should allocate shared memory with the specified size and key', () => {
        expect(stream).to.have.property('key', key);
        expect(stream).to.have.property('size', size + IPS_HEADER_SIZE);

        // Convert the key to a format recognized by ipcs -m (hexadecimal format)
        const keyFormatted = `0x${key.toString(16).padStart(8, '0')}`;

        // Execute ipcs -m command to list shared memory segments
        const output = execSync('ipcs -m').toString();

        const regex = new RegExp(`^${keyFormatted}\\s+.*$`, 'm');
        const match = regex.exec(output);

        const row = match[0].split(' ').filter(value => value !== '');

        const rowShmId = parseInt(row[1], 10);
        const rowPerms = parseInt(row[3], 10);
        const rowSize =  parseInt(row[4], 10);

        // Check if the segment exists and then verify the size
        if (match) {
            expect(rowShmId).to.be.equal(stream.shmId);
            expect(rowPerms).to.be.equal(664);
            expect(rowSize).to.be.at.least(size + IPS_HEADER_SIZE);
        } else
            throw new Error(`Shared memory segment with key ${keyFormatted} not found.`);
    });

    it('should write and read a byte sequence correctly', async () => {
        const testString = "Hello, world!"
        const testBuffer = Buffer.from(testString);

        await stream.writeAsync(testBuffer);

        const ipcRead = await readIPSBuff(key, testString.length);

        expect(ipcRead).to.equal(testString);
    });

    it('should write and read a string correctly', async () => {
        const testString = "Hello, world!"

        await stream.writeAsync(testString);

        const ipcRead = await readIPSBuff(key, testString.length);

        expect(ipcRead).to.equal(testString);
    });
});
