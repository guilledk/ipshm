import { SharedBuffer } from "../shbuf.js";

const key = parseInt(process.argv[2], 10);
const size = parseInt(process.argv[3], 10);
const readSize = parseInt(process.argv[4], 10);
const offset = parseInt(process.argv[5], 10);

const buf = new SharedBuffer(key, size, {create: false});
console.log(new TextDecoder('utf-8').decode(buf.read(readSize, offset)));
