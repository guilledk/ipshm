import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);
const expect = chai.expect;

import { describe, it } from 'mocha';

import {AsyncPosixSemaphore, maybeDeleteSemaphore} from '../semaphore.js';
import workerpool from "workerpool";
import {BUILD_DIR} from "../utils.js";
import path from "node:path";

// Semaphore management
const semaphoreMap = new Map<string, AsyncPosixSemaphore>();


function createSemaphore(semName: string, initialValue: number): AsyncPosixSemaphore {
    maybeDeleteSemaphore('test.' + semName);
    const semaphore = new AsyncPosixSemaphore('test.' + semName, {initialValue, create: true, existOk: false, permissions: 0o666});
    semaphoreMap.set(semName, semaphore);
    return semaphore;
}

async function cleanupSemaphores() {
    for (const semaphore of semaphoreMap.values()) {
        semaphore.close();
        try {
            semaphore.unlink();
        } catch (e) {
            if (!e.message.includes('Failed to unlink semaphore'))
                throw e;
        }
        await semaphore.stop();
    }
    semaphoreMap.clear();
}

describe('PosixSemaphore', function () {
    this.timeout(20000);
    let pool;

    const semOnSubprocess = async (semName: string, call: string, ...params) => {
        return await pool.exec('semInWorker', [call, 'test.' + semName, ...params]);
    };

    before(async () => {
        pool = workerpool.pool(
            path.join(BUILD_DIR, 'workers/semaphore.js'),
            {workerType: "process"}
        );
    });

    after(async () => {
        await pool.terminate(true);
        await cleanupSemaphores();
    });

    it('should initially block the wait', async () => {
        const semaphore = createSemaphore('simple', 0);
        const start = Date.now();
        setTimeout(() => semaphore.post(), 100); // Release semaphore after 100ms
        await semaphore.waitAsync(); // This should block until semaphore is posted
        const duration = Date.now() - start;
        expect(duration).to.be.at.least(100);
    });

    it('should successfully post and allow wait to complete immediately', () => {
        const semaphore = semaphoreMap.get('simple');
        semaphore.post(); // Make sure semaphore is available
        const start = Date.now();
        semaphore.wait(); // This should not block
        const duration = Date.now() - start;
        expect(duration).to.be.lessThan(50); // Assuming immediate return
    });

    it('should synchronize across processes', async function() {
        const semName = 'crossProcess';
        const semaphore = createSemaphore(semName, 0);
        // Start a subprocess that waits on the semaphore
        const waitPromise = semOnSubprocess(semName, 'wait');

        // Give the subprocess a moment to start waiting
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Post to the semaphore in the main process, allowing the subprocess to continue
        semaphore.post();

        // The waitPromise should resolve since the semaphore has been posted to
        await expect(waitPromise).to.eventually.be.fulfilled;
    });

    it('should handle semaphore unlink correctly', async function() {
        const semName = 'unlink';
        createSemaphore(semName, 0);
        await semOnSubprocess(semName, 'post');

        // Unlink the semaphore in a subprocess
        await semOnSubprocess(semName, 'unlink');

        // Attempting to wait on the semaphore after unlink should fail
        const waitPromise = semOnSubprocess(semName, 'wait');
        await expect(waitPromise).to.eventually.be.rejectedWith(Error);
    });

    it('should handle high concurrency across processes', async function() {
        const semName = 'concurrency';
        createSemaphore(semName, 0);
        const subprocesses = 10;
        const promises = [];

        // Post to semaphore equal to number of subprocesses to ensure all can proceed
        for (let i = 0; i < subprocesses; i++)
            await semOnSubprocess(semName, 'post');

        // Start multiple subprocesses that all wait on the semaphore
        for (let i = 0; i < subprocesses; i++)
            promises.push(semOnSubprocess(semName, 'wait'));

        // Wait for all subprocesses to complete their wait operation
        await Promise.all(promises).then(() => {
            console.log(`All ${subprocesses} subprocesses have successfully waited on the semaphore.`);
        });
    });
});
