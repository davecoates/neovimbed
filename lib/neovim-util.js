/* @flow */
import type { Nvim, Buffer } from 'promised-neovim-client';
import { $$textEditorBufferNumber } from './consts';

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

export function getPaneAndTextEditorForBuffer(bufferNumber:number) : {pane:atom$Pane, editor: atom$TextEditor} {
    const panes = atom.workspace.getPanes();
    for (const pane of panes) {
        for (const item of pane.getItems()) {
            if (atom.workspace.isTextEditor(item)) {
                if (item[$$textEditorBufferNumber] === bufferNumber) {
                    return {
                        pane,
                        editor: item,
                    };
                }
            }
        }
    }
    throw new Error(`Could not find TextEditor fo buffer ${bufferNumber}`);
}
