import { IPSharedMemoryReader } from "../ipshm.js";

const key = parseInt(process.argv[2], 10);
const size = parseInt(process.argv[3], 10);

const reader = new IPSharedMemoryReader(key, size);
await reader.init();

let data: string = '';
reader.on('data', (chunk: Buffer) => {
    data += chunk.toString("utf-8");
});

reader.on('end', () => {
    console.log(data);
    reader.detach();
});
