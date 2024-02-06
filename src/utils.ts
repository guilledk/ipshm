import {spawn} from "child_process";

export const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// Function to run a command and return its output as utf-8 string
export async function runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args);
        let output = '';

        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            output += data.toString();
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(output.trimEnd());
            } else {
                reject(new Error(`Command exited with code ${code}: ${output.trimEnd()}`));
            }
        });
    });
}