import path from "node:path";
import {fileURLToPath} from "node:url";

import * as winston from 'winston';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
export const BUILD_DIR = path.join(currentDir, '../build');

export const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));


export const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});