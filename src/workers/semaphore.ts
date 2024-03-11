import { PosixSemaphore } from "../semaphore.js";
import workerpool from "workerpool";

function semInWorker(call: string, semName: string, ...params) {
    const sem = new PosixSemaphore(semName, {create: false});

    if (!(call in sem))
        throw new Error(`${call} not in PosixSemaphore!`);

    return sem[call](call, ...params);
}

workerpool.worker({semInWorker});