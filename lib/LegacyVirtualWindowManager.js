/* @flow */
import type { BufferDetails, GridSize, RedrawUpdates } from './types';
import type { Nvim } from 'promised-neovim-client';
import { getBufferContents } from './neovim-util';
import {shouldIgnoreOnKeydown, getVimSpecialCharInput, getVimInputFromKeyCode} from './input';
import Screen from './Screen';

const $$textEditorInputHandler = Symbol.for('Neovimbed/TextEditorInputHandler');
const $$textEditorBufferNumber = Symbol.for('Neovimbed/TextEditorBufferNumber');

type StatusLine = {
    windowNumber: number;
    bufferNumber: number;
    windowWidth: number;
    windowHeight: number;
    cursorColumn: number;
    cursorRow: number;
}

export default class LegacyVirtualWindowManager {

    gridSize: GridSize;
    client: Nvim;
    screen: Screen;

    queuedBufferUpdates: Object<number, Function> = {};

    lineNumberColumns: number = 6;

    constructor(client: Nvim, gridSize: GridSize) {
        this.gridSize = gridSize;
        this.client = client;
        this.screen = new Screen(gridSize, this.lineNumberColumns);
    }

    async initialise() {
        await this.client.command(`set statusline=%n/%{winnr()}/%{winwidth(winnr())}x%{winheight(winnr())}/%{col('.')},%{line('.')}`)
        this.statusLineRegex =        new RegExp('([0-9]+)/([0-9]+)/([0-9]+)x([0-9]+)/([0-9]+),([0-9]+)')
        return this.client.command(`se nu norelativenumber numberwidth=${this.lineNumberColumns}`);
    }

    parseStatusLine(line:string) : ?StatusLine {
        const match = line.match(this.statusLineRegex);
        if (!match) return null;
        const values = match.slice(1, 7).map(Number);
        const [bufferNumber, windowNumber, windowWidth, windowHeight, cursorColumn, cursorRow] = values;
        return {
            windowNumber, bufferNumber, windowWidth, windowHeight, cursorColumn, cursorRow,
        };
    }

    onKeyDown(e:KeyboardEvent) : boolean {
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
        let { path } = bufferDetails;
        if (null == path) {
            path = '';
        }
        const editor:TextEditor = await atom.workspace.open(path);
        const contents = await getBufferContents(this.client, bufferDetails.bufferNumber);
        //editor.setText(contents.join("\n"));
        // $FlowIssue
        editor[$$textEditorBufferNumber] = bufferDetails.bufferNumber;
        if (this.queuedBufferUpdates[bufferDetails.bufferNumber]) {
            this.queuedBufferUpdates[bufferDetails.bufferNumber](editor);
            delete this.queuedBufferUpdates[bufferDetails.bufferNumber];
            console.log('flushing queued!');
        }
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
        // $FlowIssue
        if (!editor[$$textEditorInputHandler]) {
            // $FlowIssue
            editor[$$textEditorInputHandler] = true;
            const view = atom.views.getView(editor);
            view.addEventListener('keydown', this.onKeyDown.bind(this));
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

    async redraw(messages:RedrawUpdates) {
        if (messages.length == 0) {
            // Ignore redraw if no messages. Calling getCurrentBuffer or
            // getWindows() etc currently triggers a redraw.. so doing either
            // of those as part of redraw sequence causes redcursive redraws
            return;
        }
        for (const [message, ...updates] of messages) {
            if (this.screen[message]) {
                if (message === 'put') {
                    const str = updates.map(update => update[0]).join('');
                    console.log(message, str);
                } else {
                    console.log(message, ...updates);
                }
                for (const update of updates) {
                    // $FlowIssue Issues with either spread on undefined or tuples
                    this.screen[message](...update);
                }
            } else {
                //console.log('Unhandled!', message, ...updates);
            }
        }

        const modifiedRows = this.screen.getModifiedRows();
        console.log(modifiedRows);
        // Status line provides data we need about what the buffer is
        // TODO: This assumes 1 window currently
        const statusLine = this.parseStatusLine(this.screen.cells[this.gridSize.rows - 2].join(''));
        const blah = this.screen.cells[this.gridSize.rows - 2].join('');
        const cursorPosition = this.screen.getCursorPosition();
        this.screen.flush();
        if (!statusLine) {
            console.error('Expected to find status line but could not parse it',
                          this.screen.cells[this.gridSize.rows - 2]);
            return;
        }
        let applyChanges = textEditor => {
            console.log(statusLine);
            textEditor.setCursorBufferPosition(cursorPosition);
            if (modifiedRows) {
                const [range, rows] = modifiedRows;
                console.log(range[0], range[1], range[1][0] - range[0][0], rows.length, rows, rows.join("\n"));
                textEditor.setTextInBufferRange(range, rows.join("\n"));
                console.log(blah, textEditor[$$textEditorBufferNumber], textEditor.getText());
            }
        };
        for (const textEditor of atom.workspace.getTextEditors()) {
            if (textEditor[$$textEditorBufferNumber] === statusLine.bufferNumber) {
                applyChanges(textEditor);
                return;
            }
        }
        // TextEditor for this buffer was not found; queue update for when
        // TextEditor is loaded.
        if (this.queuedBufferUpdates[statusLine.bufferNumber]) {
            const currentUpdate = 
                this.queuedBufferUpdates[statusLine.bufferNumber];
            const combinedUpdate = textEditor => {
                currentUpdate(textEditor);
                applyChanges(textEditor);
            };
            this.queuedBufferUpdates[statusLine.bufferNumber] = combinedUpdate;
        } else {
            this.queuedBufferUpdates[statusLine.bufferNumber] = applyChanges;
        }
    }

    exit() : void {
    }

}
