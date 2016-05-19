/* @flow */
import type { Nvim, Buffer } from 'promised-neovim-client';

export async function getBuffer(client: Nvim, bufferNumber:number) : Promise<Buffer> {
    const buffers = await client.getBuffers(); 
    for (const buffer of buffers) {
        if (bufferNumber === await buffer.getNumber()) {
            return buffer;
        }
    }
    throw new Error('Buffer not found');
}

export async function getBufferContents(client: Nvim, bufferNumber: number) : Promise<Array<string>> {
    const buffer = await getBuffer(client, bufferNumber);
    const lineCount = await buffer.lineCount();

    return buffer.getLineSlice(0, lineCount, true, true);
}
