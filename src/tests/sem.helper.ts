import {PosixSemaphore} from "../semaphore.js";

const semName = process.argv[2];
const semCall = process.argv[3];

const sem = new PosixSemaphore(semName, {create: false});

if (!(semCall in sem))
    throw new Error(`PosixSemaphore class does not have a ${semCall} method`);

console.log(`opened ${sem.semName}`);

sem[semCall]();