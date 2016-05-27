'use babel';
import invariant from 'invariant';
import type { BufferDetails, GridSize, Mode, RedrawUpdates } from './types';
import type { Nvim } from 'promised-neovim-client';
import { getBufferContents, getBuffer, getPaneAndTextEditorForBuffer } from './neovim-util';
import {shouldIgnoreOnKeydown, getVimSpecialCharInput, getVimInputFromKeyCode} from './input';
import Screen from './Screen';
import { $$textEditorBufferNumber } from './consts';
import { inferModeFromCommandLineText } from './command-line';
import CommandLineInputElement from './CommandLineInputElement';

const $$textEditorInputHandler = Symbol.for('Neovimbed/TextEditorInputHandler');

type StatusLine = {
    windowNumber: number;
    bufferNumber: number;
    windowWidth: number;
    windowHeight: number;
    cursorColumn: number;
    cursorRow: number;
    totalLineCount: number;
    lastLineLength: number;
    modified: boolean;
}

export default class LegacyVirtualWindowManager {

    gridSize: GridSize;
    client: Nvim;
    screen: Screen;
    mode: Mode = 'normal';

    queuedBufferUpdates: Object<number, Function> = {};

    lineNumberColumns: number = 6;

    statusLineNumber: number;
    commandLineNumber: number;
 
    pendingUpdate = {
        row: 0,
        colStart: 0,
        colEnd: 0,
    };

    constructor(client: Nvim, gridSize: GridSize) {
        this.gridSize = gridSize;
        this.statusLineNumber = gridSize.rows - 2;
        this.commandLineNumber = gridSize.rows - 1;
        this.client = client;
        this.screen = new Screen(gridSize, this.lineNumberColumns);
        this.commandLine = new CommandLineInputElement(); 
        this.commandLine.init();

        window.neovimbed = window.neovimbed || {};

        window.neovimbed.printCells = () => {
            console.info(this.screen.cells.map(line => line.join('')).join('\n'));
        };
        window.neovimbed.printNvimBuffer = async () => {
            const buffer = await client.getCurrentBuffer();
            const lineCount = await buffer.lineCount();
            const lines = await buffer.getLineSlice(0, lineCount, true, true);
            console.log(lines.join("\n"));
        };
    }

    /**
     * Convert a cell position to a text editor position
     */
    cellToTextEditorPosition(row, column) {
        invariant(row < this.screen.cells.length, 'row must be < than grid row count');
        const lineNumberText = this.screen.cells[row].slice(0, this.lineNumberColumns).join('');
        const lineNumber = Number(lineNumberText) - 1;
        invariant(
            !Number.isNaN(lineNumber),
            `Invalid line number parsed for row ${row}. Line was ${lineNumberText}.`);
        return [lineNumber, column - this.lineNumberColumns];
    }

    async initialise() {
        // This is used to send various bits of information that we have
        // difficulty getting otherwise. See https://github.com/neovim/neovim/issues/4763
        // for what stops us getting some of this information as needed.
        await this.client.command(
            `set statusline=%n/%{winnr()}/%{winwidth(winnr())}x%{winheight(winnr())}/%{col('.')},%{line('.')}/%L/%{len(getline(line('$')))}/%{&modified}`)
        // Regex that parses the status line we receive into each component.
        // See parseStatusLine
        this.statusLineRegex = new RegExp('([0-9]+)/([0-9]+)/([0-9]+)x([0-9]+)/([0-9]+),([0-9]+)/([0-9]+)/([0-9]+)/([0|1])')
        return this.client.command(`se nu norelativenumber numberwidth=${this.lineNumberColumns}`);
    }

    parseStatusLine(line:string) : ?StatusLine {
        const match = line.match(this.statusLineRegex);
        if (!match) return null;
        const values = match.slice(1, 10).map(Number);
        const [bufferNumber, windowNumber, windowWidth, windowHeight, cursorColumn, cursorRow, totalLineCount, lastLineLength, modified] = values;
        const statusLine = {
            windowNumber, bufferNumber, windowWidth, windowHeight, cursorColumn, cursorRow, totalLineCount, lastLineLength,
            modified: !!modified,
        };
        return statusLine;
    }

    getScreenLineText(lineNumber) {
        invariant(lineNumber < this.screen.cells.length,
                  'lineNumber must be < than number of rows in the grid');
        return this.screen.cells[lineNumber].join('');
    }

    getStatusLineText() {
        return this.getScreenLineText(this.statusLineNumber);
    }

    getCommandLineText() {
        return this.getScreenLineText(this.commandLineNumber);
    }

    /** 
     * All key events get passed straight through to VIM to handle
     */
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
        editor.setText(contents.join("\n"));
        // $FlowIssue
        editor[$$textEditorBufferNumber] = bufferDetails.bufferNumber;
        if (this.queuedBufferUpdates[bufferDetails.bufferNumber]) {
            this.queuedBufferUpdates[bufferDetails.bufferNumber](editor);
            delete this.queuedBufferUpdates[bufferDetails.bufferNumber];
        }
    }

    async onEnterBuffer(details:BufferDetails) : Promise {
        try {
            const { pane, editor } = getPaneAndTextEditorForBuffer(details.bufferNumber);
            pane.activateItem(editor);
        } catch (e) {
            console.warn(e.message);
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
        const bufferNumber = item[$$textEditorBufferNumber];
        if (bufferNumber != null) {
            const buffer = await getBuffer(this.client, bufferNumber);
            this.client.setCurrentBuffer(buffer);
        } else {
            console.warn('Active item changed in atom but no matching buffer found in neovim');
        }
    }

    async onDidChangeCursorPosition(editor, cursor) {
        const { newBufferPosition: { row, column } } = cursor;
        const statusLine = this.parseStatusLine(this.getStatusLineText());
        // vim is 1 based for line numbers; atom is 0 based
        const vimRow = statusLine.cursorRow - 1;
        // Column we get back on status line is 1 based, vim itself is 0 based.
        // Atom is 0 based
        const vimColumn = statusLine.cursorColumn - 1;
        if (vimRow !== row || vimColumn !== column) {
            const win = await this.client.getCurrentWindow();
            // As above - vim is 1 based for rows and 0 based for column
            win.setCursor([row + 1, column]);
        }
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

        const lineNumberString = this.screen.cells[row].slice(0, this.lineNumberColumns).join('');

        // If start of number string is '~' then we have reached the end of the
        // file
        if (lineNumberString[0] === '~' || colStart >= colEnd || row >= (this.statusLineNumber)) {
            return;
        }

        const text = this.screen.cells[row].slice(colStart, colEnd).join('');
        // As the cells as just the visible rows we need to translate the cell
        // row number to the actual line number. We have line numbers enabled
        // to easily allow this - extract the line number from the cell
        // contents.
        const lineNumber = Number(lineNumberString) - 1;
        const range = [
            [lineNumber, colStart - this.lineNumberColumns],
            [lineNumber, colEnd - this.lineNumberColumns]
        ];

        this.batch.push([range, text]);
    }

    /**
     * Apply currently batched updates
     */
    flush() {
        const commandLineText = this.getCommandLineText()
        this.commandLine.setText(commandLineText);
        this.setMode(inferModeFromCommandLineText(this.mode, commandLineText));
        this.batchUpdate();
        const statusLine = this.parseStatusLine(this.getStatusLineText());
        if (!statusLine) {
            console.warn('Expected to find a status line but was unable to parse it',
                         this.getStatusLineText());
            return;
        }
        const changes = this.batch.slice();
        this.batch = [];
        const cursor = this.screen.cursor;
        let applyChanges = async (textEditor) => {
            if (cursor.row < this.statusLineNumber) {
                textEditor.setCursorBufferPosition(this.cellToTextEditorPosition(cursor.row, cursor.col));
            }
            for (const [range, text] of changes) {
                const [start, end] = range;
                const lineCount = textEditor.getLineCount();
                const endRangeLine = end[0] + 1;
                // If trying to set text outside of current TextEditor buffer
                // size first need to expand the buffer - otherwise text ends
                // up appended to the current last line in the buffer.
                if (lineCount < endRangeLine) {
                    const deficit = endRangeLine - lineCount + 1;
                    const buffer = textEditor.getBuffer();
                    textEditor.setTextInBufferRange(
                        [[lineCount + 1, 0], [lineCount + deficit, 0]],
                        Array.from({ length: deficit }, () => '').join("\n")
                    );
                }
                textEditor.setTextInBufferRange(range, text);
                const buffer = textEditor.getBuffer();
            }
            const textEditorLineCount = textEditor.getLineCount();
            // TODO: Atom has option to append new lines to files - will this
            // mess this up?
            if (statusLine.modified && textEditorLineCount > statusLine.totalLineCount) {
                // If text editor has more lines than status line indicates
                // remove everything from that point onwards
                const buffer = textEditor.getBuffer();
                buffer.deleteRows(statusLine.totalLineCount, textEditorLineCount);
                //const lastLine = statusLine.totalLineCount - 1;
                //const lastChangeRowLength = buffer.lineLengthForRow(lastLine);
                //buffer.delete([[lastLine, statusLine.lastLineLength], [lastLine, lastChangeRowLength]]);
            }
            if (textEditorLineCount < statusLine.totalLineCount) {
                //  If text editor length is now less than the neovim buffer we
                //  need to fetch the missing lines.
                //  TODO: This is naive and only works if the missing lines are
                //  to the bottom of the file - what if deletion is above? Can
                //  that happen?
                const buffer = textEditor.getBuffer();
                const neovimBuffer = await getBuffer(this.client, statusLine.bufferNumber);
                const lines = await neovimBuffer.getLineSlice(textEditorLineCount, statusLine.totalLineCount, true, true);
                textEditor.setTextInBufferRange(
                    [
                        [textEditorLineCount - 1, buffer.lineLengthForRow(textEditorLineCount - 1)], 
                        [statusLine.totalLineCount, 0]
                    ], '\n'+lines.join("\n"));
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

    set_scroll_region(top, bot, left, right) {
        this.screen.set_scroll_region(top, bot, left, right)
    }

    clear() {
        this.screen.clear();
    }

    eol_clear() {
        this.screen.eol_clear();
        this.batchUpdate();
        this.pendingUpdate.colEnd = this.gridSize.columns;
        this.batchUpdate();
    }

    cursor_goto(row, col) {
        this.screen.cursor_goto(row, col);
    }

    mode_change(mode:Mode) {
        this.setMode(mode);
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
                    // const str = updates.map(update => update[0]).join('');
                    // console.log('put ', str);
                } else {
                    // console.log(message, ...updates);
                }
            } else {
                // console.log('unhandled', message, ...updates);
            }
        }
        this.flush();
    }

    modeChangeListeners = [];

    onModeChange(listener) {
        this.modeChangeListeners.push(listener);
    }

    setMode(mode:Mode) {
        if (mode === this.mode) return;
        this.modeChangeListeners.forEach(listener => listener(this.mode, mode)); 
        this.mode = mode;
    }

    exit() : void {
    }

}
