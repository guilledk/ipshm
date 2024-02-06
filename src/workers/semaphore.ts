import workerpool from 'workerpool';

import {PosixSemaphore} from "../semaphore.js";


function semProxyCall(call: string, semName: string, initialValue: number = 1) {
    const sem = new PosixSemaphore(semName, {initialValue});

    if (!(call in sem))
        throw new Error(`PosixSemaphore class does not have a ${call} method`);

    sem[call]();
}

workerpool.worker({semProxyCall});
