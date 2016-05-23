'use babel';
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
 
    pendingUpdate = {
        row: 0,
        colStart: 0,
        colEnd: 0,
    };

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

    batch = [];

    /**
     * Batch update for processing at end of redraw call. The only reason this
     * is done is because we rely on the status line telling us which buffer
     * the update applies to so we have to wait until the status line is
     * updated (which happens after earlier lines) before we can update the
     * relevant Atom buffer.
     *
     * We can't use getCurrentBuffer() due to 
     * https://github.com/neovim/neovim/issues/4763
     */
    batchUpdate() {
        let { row, colStart, colEnd } = this.pendingUpdate;
        const { cursor } = this.screen;

        this.pendingUpdate.row = cursor.row;
        this.pendingUpdate.colStart = this.pendingUpdate.colEnd = cursor.col;

        // Skip cells up to number column width so we don't output line numbers
        colStart = Math.max(this.lineNumberColumns, colStart);

        if (colStart >= colEnd || row >= this.gridSize.rows - 2) {
            return;
        }

        const text = this.screen.cells[row].slice(colStart, colEnd).join('');

        const range = [
            [row, colStart - this.lineNumberColumns],
            [row, colEnd - this.lineNumberColumns]
        ];

        this.batch.push([range, text]);
    }

    /**
     * Apply currently batched updates
     */
    flush() {
        this.batchUpdate();
        const statusLine = this.parseStatusLine(this.screen.cells[this.gridSize.rows - 2].join(''));
        const changes = this.batch.slice();
        this.batch = [];
        let applyChanges = textEditor => {
            for (const change of changes) {
                textEditor.setTextInBufferRange(...change);
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

    put(text) {
        let { cursor } = this.screen;
        if (cursor.row !== this.pendingUpdate.row) {
            this.batchUpdate();
        }

        this.screen.put(text);
        cursor = this.screen.cursor;
        this.pendingUpdate.colStart = Math.min(cursor.col - 1, this.pendingUpdate.colStart);
        this.pendingUpdate.colEnd = Math.max(cursor.col, this.pendingUpdate.colEnd);
    }

    scroll(count) {
        this.batchUpdate();
        this.screen.scroll(count);
    }

    set_scroll_region(self, top, bot, left, right) {
        this.screen.set_scroll_region(top, bot, left, right)
    }

    eol_clear() {
        this.screen.eol_clear();
        this.pendingUpdate.colEnd = this.gridSize.columns;
        this.batchUpdate();
    }

    cursor_goto(row, col) {
        this.screen.cursor_goto(row, col);
    }

    mode_change(mode) {
        this.screen.mode_change(mode);
    }

    clear_region(top, bot, left, right) {
        this.batchUpdate();
        this.screen.clear_region(top, bot, left, right);
    }

    async redraw(messages:RedrawUpdates) {
        for (const [message, ...updates] of messages) {
            if (this[message]) {
                for (const update of updates) {
                    // $FlowIssue Issues with either spread on undefined or tuples
                    this[message](...update);
                }
                if (message === 'put') {
                    const str = updates.map(update => update[0]).join('');
                    console.log('put ', str);
                }
            }
        }
        this.flush();
    }

    exit() : void {
    }

}
