'use babel';

const modeByIndicatorString = {
    '-- VISUAL --': 'visual',
    '-- VISUAL BLOCK --': 'visual_block',
};

const indicatorStringByMode = {
    visual: '-- VISUAL --',
    visual_block: '-- VISUAL BLOCK --',
};

function inferModeFromExCommandLine(currentMode, line) {
    for (let indicator in modeByIndicatorString) {
        if (line.substr(0, indicator.length) === indicator) {
            return modeByIndicatorString[indicator];
        }
    }
    if (indicatorStringByMode[currentMode]) {
        // If current mode is an inferred mode and we can no longer infer it
        // from the command line string then we assume we are back to normal
        // mode.
        return 'normal';
    }
    return null;
}

function range(start, stop, step = 1) {
    let numbers = [];
    if (start < stop) {
        for (let i=start;i < stop; i += step) {
            numbers.push(i);
        }
        return numbers;
    }
    for (let i=start;i > stop;i += step) {
        numbers.push(i);
    }
    return numbers;
}
    
export default class Screen {


    // Dimensions of screen
    rows = null;
    cols = null;

    // Current cursor position
    row = 0;
    col = 0;

    top = 0;
    bottom = 0;
    left = 0;
    right = 0;

    selectedRegion = null;

    // rows x cols array, each element in nested array a character
    cells = [];

    modifiedRange = null;

    constructor(gridSize, lineNumberColumns) {
        this.lineNumberColumns = lineNumberColumns;
        this.rows = gridSize.rows;
        this.cols = gridSize.columns;
        this.top = 0
        this.bot = this.rows - 1
        this.left = 0
        this.right = this.cols - 1

        this.exCommandRowNumber = this.rows - 1;
        this.statusBarRowNumber = this.rows - 2;
        for (let i = 0; i < this.rows; i++) {
            this.cells[i] = [];
            for (let j = 0; j < this.cols; j++) {
                this.cells[i][j] = ' ';
            }
        }
    }

    /**
     * Expand any selections when in visual or visual block mode based on
     * current cursor position
     */
    expandSelectedRegion() {
        if (this.row >= this.exCommandRowNumber) return;

        // Column is incremented by 1 to match VIM behaviour - seems to include
        // the column the cursor is now on after expanding selection
        if (this.mode === 'visual') {
            this.selectedRegion[1] = [this.row, this.col + 1];
        }
        if (this.mode === 'visual_block') {
            // We track selections in visual block line by line
            if (!this.selectedRegionsByRow[this.row]) {
                this.selectedRegionsByRow[this.row] = [this.col, this.col + 1];
            } else {
                this.selectedRegionsByRow[this.row][1] = this.col + 1;
            }
        }
    }

    cursor_goto(row, col) {
        this.row = row;
        this.col = col;
        this.expandSelectedRegion();
    }

    eol_clear() {
        for (let i = this.col; i < this.cells[this.row].length; i++) {
            this.cells[this.row][i] = ' ';
        }
        if (!this.modifiedRange) {
            this.modifiedRange = [[this.row, this.col]];
        }
        this.modifiedRange[1] = [this.row, this.cells[this.row].length];
        console.log('modified', 'eol_clear', ...this.modifiedRange[1]); 
    }

    put(text) {
        // Temporary; ignore status bar updates for now
        if (this.row == this.exCommandRowNumber) {
            this.cells[this.row][this.col] = text;
            this.col++;
            this.expandSelectedRegion();
            return;
        }

        if (!this.modifiedRange) {
            this.modifiedRange = [[this.row, this.col]];
        }

        this.cells[this.row][this.col] = text;
        this.col++;
        this.expandSelectedRegion();

        this.modifiedRange[1] = [this.row, this.col];
    }

    mode_change(mode) {
        this.mode = mode;
        if (mode === 'visual') {
            this.selectedRegion = [[this.row, this.col], [this.row, this.col + 1]];
            this.selectedRegionsByRow = null;
        } else if (mode === 'visual_block') {
            this.selectedRegionsByRow = {
                [this.row]: [this.col, this.col + 1],
            };
            this.selectedRegion = null;
        } else {
            this.selectedRegion = null;
            this.selectedRegionsByRow = null;
        }
    }

    /**
     * Shift scroll region
     * Ported from: https://github.com/neovim/python-gui/blob/master/neovim_gui/screen.py
     */
    scroll(count) {
        const { top, bot, left, right } = this;
        let start, stop, step;
        if (count > 0) {
            start = top;
            stop = bot - count + 1;
            step = 1;
        } else {
            start = bot;
            stop = top - count - 1;
            step = -1;
        }
        // shift the cells
        for (const i of range(start, stop, step)) {
            for (let j = left; j <= right; j++) {
                this.cells[i][j] = this.cells[i + count][j];
            }
        }
        // clear invalid cells
        for (const i of range(stop, stop + count, step)) {
            this.clear_region(i, i, left, right);
        }
    }

    set_scroll_region(top, bot, left, right) {
        this.top = top;
        this.bot = bot;
        this.left = left;
        this.right = right;
        this.modifiedRange = [[0,0], [this.rows, this.cols]];
        console.log('modified', 'setscrollregion', ...this.modifiedRange[1]); 
    }

    clear_region(top, bot, left, right) {
        for (let i = top; i < bot + 1; i++) {
            for (let j = left; j < right + 1; j++) {
                this.cells[i][j] = ' ';
            }
        }
    }

    async bufferFlush(buffer, exModeInput) {
        const exText = this.cells[this.exCommandRowNumber].join('');
        const inferredMode = inferModeFromExCommandLine(this.mode, exText);
        if (inferredMode && this.mode !== inferredMode) {
            this.mode_change(inferredMode);
        }
        const editor = await buffer.editorPromise;
        const nvimBuffer = await buffer.getNvimBuffer();
        const nvimBufferLineCount = await nvimBuffer.lineCount()
        const editorLineCount = editor.getLineCount();
        exModeInput.editor.setText(exText);
        if (this.row < editorLineCount) {
            editor.setCursorBufferPosition([this.row, this.col]);
        }
        if (this.modifiedRange) {
            const [start, end] = this.modifiedRange;
            const rows = [];
            for (let i = start[0]; i <= end[0]; i++) {
                if (i > nvimBufferLineCount) break; 
                const lineX = i === start[0] ? start[1] : 0;
                if (i === end[0]) {
                    rows.push(this.cells[i].slice(lineX, end[1]).join(''));
                } else {
                    rows.push(this.cells[i].slice(lineX).join(''));
                }
            }
            const text = rows.join("\n");
            console.log(text);
            if (end[0] >= nvimBufferLineCount) {
                end[0] = nvimBufferLineCount - 1;
            }
            editor.setTextInBufferRange([start, end], text);
            if (nvimBufferLineCount <= editorLineCount) {
                editor.getBuffer().deleteRows(nvimBufferLineCount, editorLineCount);
            }
            this.modifiedRange = null;
        }
        if (this.selectedRegion) {
            editor.addSelectionForBufferRange(this.selectedRegion);
        }
        if (this.selectedRegionsByRow) {
            const ranges = [];
            for (const i in this.selectedRegionsByRow) {
                const rowNum = Number(i);
                const [start, end] = this.selectedRegionsByRow[rowNum];
                ranges.push([[rowNum, start], [rowNum, end]]);
            }
            editor.setSelectedBufferRanges(ranges);
        }
    }

    getModifiedRows() {
        console.log('cells:', this.cells.map(row => row.join("")).join("\n"));
        if (this.modifiedRange) {
            const [start, end] = this.modifiedRange;
            const rows = [];
            console.log('modified', [...this.modifiedRange[1]])
            const finalRange = [
                [start[0], start[1] - this.lineNumberColumns],
                [end[0], end[1] - this.lineNumberColumns]
            ];
            let lastIndex;
            for (let i = start[0]; i <= Math.min(end[0], this.statusBarRowNumber - 1); i++) {
                // We have reached end of actual content, the rest is just
                // empty line indicators. We can safely do this as we have line
                // number enabled which are only shown against actual lines
                // that exist in the buffer
                if (this.cells[i].join('').replace(new RegExp(' ', 'g'), '') === '' || this.cells[i] === '~') {
                    // TODO: ^ This is not ideal - why aren't we seeing '~'
                    // coming through?
                    console.log("greater", this.cells[i].join(""));
                    finalRange[1][0] = i - 1;
                    break;
                }
                const lineX = Math.max(i === start[0] ? start[1] : 0, this.lineNumberColumns);
                if (i === end[0]) {
                    rows.push(this.cells[i].slice(lineX, end[1]).join(''));
                } else {
                    rows.push(this.cells[i].slice(lineX).join(''));
                }
                lastIndex = i;
            }
            if (rows.length === 0) return false;

            const firstLineNumber = Number(this.cells[start[0]].slice(0, this.lineNumberColumns).join(''));
            const lastLineNumber = Number(this.cells[lastIndex].slice(0, this.lineNumberColumns).join(''));

            return [
                [[firstLineNumber - 1, start[1] - this.lineNumberColumns],
                [lastLineNumber - 1, this.cols]],
                rows
            ];
        }
        return false;
    }

    getCursorPosition() {
        return [this.row + this.getOffsetLine(), this.col - this.lineNumberColumns];
    }

    getOffsetLine() {
        return Number(this.cells[0].slice(0, this.lineNumberColumns).join('')) - 1;
    }

    flush() {
        this.modifiedRange = null;
    }

}
