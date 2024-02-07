import {expect} from "chai";
import {maybeDeleteSharedBuffer, SharedBuffer} from "../shbuf.js";
import {FieldManager} from "../sync.js";
import workerpool from "workerpool";
import {maybeDeleteSemaphore} from "../semaphore.js";

const semPrefix = 'synctest';
const magicStr = 'magicstr';
const testFieldConfig = {
    magic: {offset: 0, size: magicStr.length},
    count: {offset: magicStr.length, size: 8}
};

async function decrementSharedCountSynced(key: number, size: number) {
    // need to define everything that will be used in this function
    // locally due to it being run in a separate process
    const semPrefix = 'synctest';
    const magicStr = 'magicstr';
    const testFieldConfig = {
        magic: {offset: 0, size: magicStr.length},
        count: {offset: magicStr.length, size: 8}
    };
    // @ts-ignore
    const { SharedBuffer } = await import('../../../build/shbuf.js');
    // @ts-ignore
    const { FieldManager } = await import('../../../build/sync.js');

    const sharedBuffer = new SharedBuffer(key, size, {create: false});
    const fieldManager = new FieldManager(sharedBuffer.buffer, testFieldConfig, semPrefix);

    // verify magic str
    const magicRaw = await fieldManager.getSequence('magic');
    const magic = new TextDecoder().decode(magicRaw);
    if (magic !== magicStr)
        throw new Error(`Magic string is wrong!`);

    // decrement counter
    const counterLock = await fieldManager.acquire('count');
    const count = fieldManager._getValue('count');
    await new Promise(resolve => setTimeout(resolve, 20));
    fieldManager._setValue('count', count - BigInt(1));
    counterLock.post();

    await fieldManager.close();
}

async function decrementSharedCountNaive(key: number, size: number) {
    // @ts-ignore
    const { SharedBuffer } = await import('../../../build/shbuf.js');
    const sharedBuffer = new SharedBuffer(key, size, {create: false});
    const offset = 8;

    // do naive decrement
    const count = sharedBuffer.buffer.readBigUInt64LE(offset);
    await new Promise(resolve => setTimeout(resolve, 20));
    sharedBuffer.buffer.writeBigUInt64LE(count - BigInt(1), offset);

    sharedBuffer.detach();
}


describe('Sync Module', function() {
    this.timeout(10000)
    const countTarget = BigInt(100);
    let pp;

    const key = 123456;
    const size = magicStr.length + 8;

    const bufferOptions = {
        create: true,
        existOk: true,
        permissions: 0o666,
    };

    let sharedBuffer: SharedBuffer;
    let fieldManager: FieldManager;

    before(() => {
        pp = workerpool.pool({workerType: "process"});
        maybeDeleteSharedBuffer(key);
        Object.keys(testFieldConfig).forEach(field => maybeDeleteSemaphore(`${semPrefix}_${field}`));
        sharedBuffer = new SharedBuffer(key, size, bufferOptions);
        fieldManager = new FieldManager(
            sharedBuffer.buffer, testFieldConfig, semPrefix, {create: true, existOk: false, initialValue: 1});
    });

    after(async () => {
        await fieldManager.close(true);
        sharedBuffer.detach();
        sharedBuffer.remove();
        await pp.terminate(true);
    });

    it ('should have race conditions accessing the buffer without proper field manager use', async function() {
        // write count right away
        sharedBuffer.buffer.writeBigUInt64LE(BigInt(countTarget), testFieldConfig.count.offset);

        // Run naive decrementer processes
        const tasks = [];
        for (let i = 0; BigInt(i) < countTarget; i++) {
            tasks.push(
                pp.exec(decrementSharedCountNaive, [key, size]).catch(
                    (error) => {
                        console.log(error.message);
                        console.log(error.stack);
                        throw error;
                    }
                )
            );
        }

        await Promise.all(tasks);

        // if race conditions happened its likely that count is non zero
        const finalCount = sharedBuffer.buffer.readBigUInt64LE(testFieldConfig.count.offset);
        expect(finalCount).to.not.be.equal(BigInt(0));
    });

    it('should be able to set and get magic sequence from main proc', async function() {
        // Write magic string to field
        const magicBuf = Buffer.from(new TextEncoder().encode(magicStr));
        await fieldManager.setSequence('magic', magicBuf);

        const inBufMagic = await fieldManager.getSequence('magic');

        expect(inBufMagic).to.be.deep.equal(magicBuf);
    });

    it('should have zero value on count field after many child processes modify it', async function() {
        // Write count
        await fieldManager.setValue('count', countTarget);

        // Run decrementer processes
        const tasks = [];
        for (let i = 0; BigInt(i) < countTarget; i++) {
            tasks.push(
                pp.exec(decrementSharedCountSynced, [key, size]).catch(
                    (error) => {
                        console.log(error.message);
                        console.log(error.stack);
                        throw error;
                    }
                )
            );
        }

        await Promise.all(tasks);

        // Check count == zero
        const finalCount = await fieldManager.getValue('count');
        expect(finalCount).to.be.equal(BigInt(0));
    });
});
