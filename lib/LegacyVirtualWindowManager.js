/* @flow */
import type { BufferDetails, GridSize, RedrawUpdates } from './types';
import type { Nvim } from 'promised-neovim-client';
import { getBufferContents } from './neovim-util';
import {shouldIgnoreOnKeydown, getVimSpecialCharInput, getVimInputFromKeyCode} from './input';

const $$textEditorInputHandler = Symbol.for('Neovimbed/TextEditorInputHandler');

export default class LegacyVirtualWindowManager {

    gridSize: GridSize;
    client: Nvim;

    constructor(client: Nvim, gridSize: GridSize) {
        this.gridSize = gridSize;
        this.client = client;
    }

    onKeyDown = (e:KeyboardEvent) => {
        const specialSequence = getVimSpecialCharInput(e);
        if (shouldIgnoreOnKeydown(e)) {
            return false;
        }
        e.stopPropagation();
        e.preventDefault();
        const input = specialSequence == null ? getVimInputFromKeyCode(e) : specialSequence;
        this.client.input(input);

        return false;
    }

    /**
     * Whenever a buffer is read in neovim we force TextEditor to match it's
     * contents
     */
    async onReadBuffer(bufferDetails:BufferDetails) : Promise {
        const editor = await atom.workspace.open(bufferDetails.path || '');
        const contents = await getBufferContents(this.client, bufferDetails.bufferNumber);
        editor.setText(contents.join("\n"));
    }

    async onNewFileBuffer(buffer:BufferDetails) : Promise {
    }

    async onNewEmptyBuffer(buffer:BufferDetails) : Promise {
    }

    async onDeleteBuffer(buffer:BufferDetails) : Promise {
    }

    onAddTextEditor(pane: atom$Pane, editor: atom$TextEditor) : void {
        const path = editor.getPath();
        this.client.command(path ? `e ${path}` : 'enew').catch(e => {
            // E325: ATTENTION is start of string when you have a swap file
            // We only receive this message after a decision has been made
            // about what to do. We can safely ignore this one.
            if (!e.message.match(/E325: ATTENTION/)) {
                console.error(`Unexpected error opening file '${path}'`, e);
                return;
            }
        });
        if (!editor[$$textEditorInputHandler]) {
            editor[$$textEditorInputHandler] = true;
            const view = atom.views.getView(editor);
            view.addEventListener('keydown', this.onKeyDown);
        }
    }

    onRemoveTextEditor(pane: atom$Pane, editor: atom$TextEditor, moved: boolean) : void {
        console.log('REMOVE TEXT EDITOR', pane, editor, moved);
    }

    onRemovePane(pane: atom$Pane) : void {
    }

    async onAddPane(pane: atom$Pane) {
        // console.log('add pane', pane);
    }

    async onActivePaneItem(item: mixed) {
    }

    redraw(updates:RedrawUpdates) : void {
        // console.log('redraw', updates);
    }

    exit() : void {
    }

}
