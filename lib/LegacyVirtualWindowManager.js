'use babel';
import invariant from 'invariant';
import type { BufferDetails, GridSize, Mode, RedrawUpdates } from './types';
import type { Nvim } from 'promised-neovim-client';
import { getBufferContents, getBuffer, getPaneAndTextEditorForBuffer } from './neovim-util';
import { promisify } from './util';
import {shouldIgnoreOnKeydown, getVimSpecialCharInput, getVimInputFromKeyCode} from './input';
import Screen from './Screen';
import { $$textEditorBufferNumber } from './consts';
import { inferModeFromCommandLineText } from './command-line';
import CommandLineInputElement from './CommandLineInputElement';
import SwapFileMessageElement from './SwapFileMessageElement';

const $$textEditorInputHandler = Symbol.for('Neovimbed/TextEditorInputHandler');
// Use to track the initial contents on an editor so we can ignore the change
// events for them. We track change events in general so we can pass through
// changes that occur outside of neovim to neovim.
const $$textEditorInitialContents = Symbol.for('Neovimbed/TextEditorInitialContents');

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

    modeChangeListeners:Array<Function> = [];

    queuedBufferUpdates: Object<number, Array<Function>> = {};

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

        this.swapFileMessage = new SwapFileMessageElement();
        this.swapFileMessage.init();

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
            `set statusline=%n/%{winnr()}/%{winwidth(winnr())}x%{winheight(winnr())}/%{virtcol('.')},%{line('.')}/%L/%{len(getline(line('$')))}/%{&modified}`)
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
        const contents = (await getBufferContents(this.client, bufferDetails.bufferNumber)).join('\n');
        editor[$$textEditorInitialContents] = contents;
        // $FlowIssue
        editor[$$textEditorBufferNumber] = bufferDetails.bufferNumber;
        editor.setText(contents);
        this.processNextBufferUpdate(editor);
    }

    /**
     * When a buffer is entered in neovim activate relevant TextEditor
     */
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

    async onBufferWritePost(details:BufferDetails) : Promise {
        // I don't think there's anything we can do - the TextEditor will be
        // shown as modified even though the underlying file has just been
        // saved.
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
        if (!atom.workspace.isTextEditor(item)) {
            return;
        }
        const bufferNumber = item[$$textEditorBufferNumber];
        if (bufferNumber != null) {
            const buffer = await getBuffer(this.client, bufferNumber);
            this.client.setCurrentBuffer(buffer);
        } else {
            console.warn('Active item changed in atom but no matching buffer found in neovim');
        }
    }

    disableCursorPositionSync = false;

    onDidChangeCursorPosition(editor, cursor) {
        if (this.disableCursorPositionSync) return;
        const { newBufferPosition: { row, column } } = cursor;
        const statusLine = this.parseStatusLine(this.getStatusLineText());
        // vim is 1 based for line numbers; atom is 0 based
        const vimRow = statusLine.cursorRow - 1;
        // Column we get back on status line is 1 based, vim itself is 0 based.
        // Atom is 0 based
        const vimColumn = statusLine.cursorColumn - 1;

        if (vimRow !== row || vimColumn !== column) {
            this.client.getCurrentWindow().then(win => {
                // As above - vim is 1 based for rows and 0 based for column
                const position = [row + 1, column];
                win.setCursor(position).catch(e => {
                    console.warn('Failed to set cursor position', position, e);
                });
            });
        }
    }

    disableBufferTracking = new WeakMap();
    pendingExternalBufferChanges = new WeakMap();

    /**
     * Whenever a buffer changes track the change unless we are within a
     * redraw. Within a redraw we flag the texteditor as disabled in 
     * this.disableBufferTracking. This stops us recording change events
     * triggered by the changes made in redraw. 
     * This is intended to track changes made to the text that did not come
     * from neovim.
     * @ see onDidBufferStopChanging() for when these changes are flushed.
     */
    onDidBufferChange(editor:TextEditor, event) {
        if (this.disableBufferTracking.get(editor)) {
            return;
        }
        if (editor[$$textEditorInitialContents] && editor[$$textEditorInitialContents] === event.newText) {
            // When an editor first loads we set it's contents - we need to
            // ignore the change event for this
            delete editor[$$textEditorInitialContents];
            return;
        }
        if (!this.pendingExternalBufferChanges.has(editor)) {
            this.pendingExternalBufferChanges.set(editor, []);
        }
        this.pendingExternalBufferChanges.get(editor).push(event);
    }

    /**
     * Push all changes that occurred outside of neovim into neovim
     * We do this naively - we replace every line that changed in neovim with
     * the full line from atom. There's no way to replace parts of lines
     * via the neovim API.
     */
    async onDidBufferStopChanging(editor:TextEditor) {
        const changes = this.pendingExternalBufferChanges.get(editor);
        const cursorPosition = {...editor.getCursorBufferPosition()};
        if (!changes || !changes.length || !editor[$$textEditorBufferNumber]) {
            return;
        }
        this.pendingExternalBufferChanges.delete(editor);
        const bufferTrackerFlag = this.disableBufferTracking.get(editor); 
        // Ensure we don't track any more changes while we do this
        this.disableBufferTracking.set(editor, true); 

        // Don't jump cursor around while doing these changes
        const previousDisableCursorPositionSync = this.disableCursorPositionSync;
        this.disableCursorPositionSync = true;
        const neovimBuffer = await getBuffer(this.client, editor[$$textEditorBufferNumber]);
        const setLineSliceCalls = [];
        for (const change of changes) {
            const { newRange, oldRange, newText } = change;
            const newLines = editor.getBuffer().lines.slice(newRange.start.row, newRange.end.row + 1);
            setLineSliceCalls.push([oldRange.start.row, oldRange.end.row, true, true, newLines]);
        }
        for (const params of setLineSliceCalls) {
            await neovimBuffer.setLineSlice(...params);
        }
        this.client.getCurrentWindow().then(win => {
            // As above - vim is 1 based for rows and 0 based for column
            win.setCursor([cursorPosition.row + 1, cursorPosition.column]);
            this.disableCursorPositionSync = previousDisableCursorPositionSync;
            // Reset
            this.disableBufferTracking.set(editor, bufferTrackerFlag); 
        });
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
        // file. Ignore changes is the line number column and any changes on
        // rows outside of the main text buffer (eg. the status line and
        // command line)
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


    isSwapFileWarning(commandLineText) {
        return commandLineText.replace(/[\s]*$/, '') === '[O]pen Read-Only, (E)dit anyway, (R)ecover, (Q)uit, (A)bort:';
    }

    /**
     * Apply currently batched updates
     */
    flush() {
        const commandLineText = this.getCommandLineText();
        const statusLineText = this.getStatusLineText();
        this.commandLine.setText(commandLineText);

        if (this.isSwapFileWarning(commandLineText)) {
            const text = this.screen.cells.map(line => line.join('')).join('\n');
            this.swapFileMessage.setText(text);
            this.swapFileMessage.show();
            return;
        }
        this.swapFileMessage.hide();

        this.setMode(inferModeFromCommandLineText(this.mode, commandLineText));

        this.batchUpdate();

        const statusLine = this.parseStatusLine(statusLineText);
        if (!statusLine) {
            console.warn('Expected to find a status line but was unable to parse it',
                         this.getStatusLineText());
            return;
        }

        if (statusLine.bufferNumber == null) {
            console.warn(`Unable to process updateds; status line doesn't contain buffer number`);
            return;
        }

        const cursor = {...this.screen.cursor};
        if (this.batch.length === 0) {
            // We must sync cursor position even if no other updates - this is
            // because we get redraw calls for cursor position updates (as it
            // changes the line number) but doesn't actually cause anything to
            // be redrawn in Atom
            if (cursor.row < this.statusLineNumber && !this.disableCursorPositionSync) {
                for (const textEditor of atom.workspace.getTextEditors()) {
                    if (textEditor[$$textEditorBufferNumber] === statusLine.bufferNumber) {
                        this.setEditorCursorPosition(textEditor, cursor);
                        break;
                    }
                }
            }
            // Don't do anything more if we have no batched updates
            return;
        }

        const changes = this.batch.slice();
        this.batch = [];

        let applyChanges = (textEditor) => {
            this.disableCursorPositionSync = true;
            this.disableBufferTracking.set(textEditor, true);
            const setTextInBufferRange = (range, text) => {
                const buffer = textEditor.getBuffer();
                const lineLength = buffer.lines.length > range[0][0] ? buffer.lineLengthForRow(range[0][0]) : 0;
                // If line isn't long enough for range it will get added at the
                // end of the current string - left pad string with spaces to
                // compensate for this
                if (lineLength < range[0][1]) {
                    const diff = range[0][1] - lineLength;
                    range[0][1] = lineLength;
                    text = Array.from({ length: diff }, () => ' ').join('') + text;
                }
                textEditor.setTextInBufferRange(range, text);
            };

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
                    buffer.append(
                        Array.from({ length: deficit }, () => '\n').join('')
                    );
                }
                setTextInBufferRange(range, text);
            }

            const textEditorLineCount = textEditor.getLineCount();
            const linesAdded = statusLine.totalLineCount - textEditorLineCount;
            const lineNumberText = this.screen.cells[this.screen.cells.length - 3].slice(0, this.lineNumberColumns).join('').trim();
            let lineNumber = Number(lineNumberText) - 1;
            if (lineNumberText === '') {
                lineNumber = NaN;
            }
            const promises = [];
            if (!Number.isNaN(lineNumber) && linesAdded > 0) {
                /**
                 * Lines have been added to the screen
                 * Before                 After insertion
                 * -----                  -----
                 * line1                  line1
                 * line2  => insert line  line2
                 * line3                  new line 
                 * -----                  -----       <--- add line 3 back here
                 * line4                  line4
                 *
                 * We need to insert line3 back in between 'new line' and line
                 * 4. The dashes contain the screen as tracked by this.screen.
                 */
                const buffer = textEditor.getBuffer();
                const p = getBuffer(this.client, statusLine.bufferNumber)
                    // Fetch lines from neovim buffer
                    // TODO: Some cases seem to need the +1 at end of range (second
                    // parameter), others not! Add test case for both - current
                    // test case is for without needing +1, no idea why
                    .then(neovimBuffer => neovimBuffer.getLineSlice(lineNumber + 1, lineNumber + linesAdded, true, true))
                    // Insert them into text editor
                    .then(lines => {
                        let text = lines.join('\n')+'\n';
                        if (buffer.lines.length <= (lineNumber + 1)) {
                            // If we have less lines then needed add an extra
                            // newline to accommodate it
                            // TODO: Doesn't this assume there's only a
                            // difference of 1? Shouldn't we add as many
                            // newline as required?
                            text = '\n' + text;
                        }
                        buffer.insert([lineNumber + 1, 0], text);
                    });
                promises.push(p);
            }
            return Promise.all(promises).then(async () => {
                if (!Number.isNaN(lineNumber) && linesAdded < 0) {
                    /**
                     * Lines have been removed
                     * Before                 After removal
                     * -----                  -----
                     * line1                  line1
                     * line2  => remove line  line3
                     * line3                  line4
                     * -----                  ----- 
                     * line4                  line4     <--- remove line 4
                     * line5                  line5
                     *
                     * We need to remove line4 as it now appears twice
                     */
                    const buffer = textEditor.getBuffer();
                    buffer.deleteRows(lineNumber + 1, lineNumber - linesAdded);
                }
                if (textEditor.getLineCount() > statusLine.totalLineCount) {
                    const buffer = textEditor.getBuffer();
                    // Actually verify the line count on status line is correct -
                    // it seems to sometimes not be.
                    await getBuffer(this.client, statusLine.bufferNumber)
                        .then(neovimBuffer => neovimBuffer.lineCount())
                        .then(lineCount => {
                            if (textEditor.getLineCount() > lineCount) {
                                buffer.deleteRows(lineCount, buffer.lines.length - 1);
                            }
                        });
                }
                this.disableCursorPositionSync = false;
                if (cursor.row < this.statusLineNumber && !this.disableCursorPositionSync) {
                    this.setEditorCursorPosition(textEditor, cursor);
                }
                this.disableBufferTracking.set(textEditor, false);

                // Kick off next buffer update
                this.processNextBufferUpdate(textEditor);
            });
        };
        if (!this.queuedBufferUpdates[statusLine.bufferNumber]) {
            this.queuedBufferUpdates[statusLine.bufferNumber] = [];
        }
        this.queuedBufferUpdates[statusLine.bufferNumber].push(applyChanges);
        for (const textEditor of atom.workspace.getTextEditors()) {
            if (textEditor[$$textEditorBufferNumber] === statusLine.bufferNumber) {
                this.processNextBufferUpdate(textEditor);
                return;
            }
        }
        // TextEditor for this buffer was not found; update has been queued
        // anyway and will process once the buffer is loaded - see
        // this.onReadBuffer
    }

    // Track pending updates to TextEditor. 
    bufferUpdates = new WeakMap();

    /**
     * This exists to process buffer updates in order. As interacting with
     * neovim is async and may cause new redraw calls to occur while a batch is
     * processing we want to capture things as they happen and then delay
     * processing until previous updates have been processed.
     *
     * I'm not sure this is entirely sound but resolved issues that were
     * occurring based on order of operations.
     */
    processNextBufferUpdate(editor:atom$TextEditor) {
        const bufferNumber = editor[$$textEditorBufferNumber];
        invariant(bufferNumber != null, 'Expected processNextBufferUpdate to be called only once editor has buffer matched to it');
        const updates = this.queuedBufferUpdates[bufferNumber] || [];
        const update = updates.shift();
        if (update) {
            // When current promise (if any) resolves then action this update.
            // The update returns a promise that will then be used by the next
            // call to this function.
            this.bufferUpdates.set(
                editor,
                promisify(this.bufferUpdates.get(editor)).then(() => update(editor))
            );
        }
    }

    setEditorCursorPosition(editor, screenCursorPosition) {
        const { row, col } = screenCursorPosition;
        const transformedPosition = this.cellToTextEditorPosition(row, col)
        const buffer = editor.getBuffer();
        if (buffer.lines.length <= transformedPosition[0]) {
            buffer.append('\n'.repeat(transformedPosition[0] - buffer.lines.length + 1));
        }
        const rowLength = buffer.lineLengthForRow(transformedPosition[0]);
        if (rowLength < transformedPosition[1]) {
            // Visible length of row may be less than cursor position we are
            // receiving from neovim. This is because we won't necessarily have
            // redrawn if just whitespace to the end of row has changed. Expand
            // row in buffer to required length to accommodate new cursor
            // position.
            const position = [transformedPosition[0], rowLength];
            buffer.setTextInRange([position, position],
                                  ' '.repeat(transformedPosition[1] - rowLength));
        }
        editor.setCursorBufferPosition(transformedPosition);
    }

    /**
     * Register a mode change listener
     */
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

    //========================================================================
    // Redraw handlers below here. These notify the Screen instance of changes
    // from neovim and batch any updates ready for next flush. Updates are
    // batched per line.

    /**
     * Here we receive individual character updates from neovim.
     */
    put(text) {
        let { cursor } = this.screen;
        // Line isn't same as last update, batch current change
        if (cursor.row !== this.pendingUpdate.row) {
            this.batchUpdate();
        }

        this.screen.put(text);
        cursor = this.screen.cursor;

        // Track range of text for this line that has changed
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

    /**
     * Update cursor position. Cursor position set here is used for any calls
     * that come after it. The final cursor_goto call in each redraw() batch is
     * where the actual visible cursor will be.
     */
    cursor_goto(row, col) {
        this.screen.cursor_goto(row, col);
    }

    /**
     * We only receive mode change events for normal and insert mode. Other
     * modes we determine using other means (see inferModeFromCommandLineText)
     */
    mode_change(mode:Mode) {
        this.setMode(mode);
    }

    clear_region(top, bot, left, right) {
        this.batchUpdate();
        this.screen.clear_region(top, bot, left, right);
    }

    /**
     * Dispatches messages from neovim to one of the above functions. Those
     * functions pass messages down to the Screen instance and handle any
     * other changes that are needed.
     *
     * All messages are processed before we reflect anything in Atom (see
     * flush)
     */
    redraw(messages:RedrawUpdates) {
        // Lots of empty messages come through; so a single keypress could
        // cause half a dozen redraw's which killed performance (mainly around
        // syncing cursor position). Just ignore empty one's entirely.
        if (messages.length === 0) return;
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

}
