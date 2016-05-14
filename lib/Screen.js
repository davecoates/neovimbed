'use babel';
    
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

    // rows x cols array, each element in nested array a character
    cells = [];

    modifiedRange = null;

    constructor(cols, rows) {
        this.rows = rows;
        this.cols = cols;
        this.top = 0
        this.bot = rows - 1
        this.left = 0
        this.right = cols - 1

        this.exCommandRowNumber = this.rows - 1;
        for (let i = 0; i < this.rows; i++) {
            this.cells[i] = [];
            for (let j = 0; j < this.cols; j++) {
                this.cells[i][j] = ' ';
            }
        }
    }

    cursor_goto(row, col) {
        this.row = row;
        this.col = col;
    }

    eol_clear() {
        for (let i = this.col; i < this.cells[this.row].length; i++) {
            this.cells[this.row][i] = ' ';
        }
        if (!this.modifiedRange) {
            this.modifiedRange = [[this.row, this.col]];
        }
        this.modifiedRange[1] = [this.row, this.cells[this.row].length];
    }

    put(text, attrs) {
        // Temporary; ignore status bar updates for now
        if (this.row == this.exCommandRowNumber) {
            this.cells[this.row][this.col] = text;
            this.col++;
            return;
        }

        if (!this.modifiedRange) {
            this.modifiedRange = [[this.row, this.col]];
        }

        this.cells[this.row][this.col] = text;
        this.col++;

        this.modifiedRange[1] = [this.row, this.col]
    }

    mode_change(mode) {
        this.mode = mode;
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
        for (let i = start; i < stop; i += step) {
            for (let j = left; j <= right; j++) {
                this.cells[i][j] = this.cells[i + count][j];
            }
        }
        // clear invalid cells
        for (let i = stop; i < stop + count; i+= step) {
            this.clear_region(i, i, left, right);
        }
    }

    set_scroll_region(top, bot, left, right) {
        this.top = top;
        this.bot = bot;
        this.left = left;
        this.right = right;
        this.modifiedRange = [[0,0], [79, 79]];
    }

    clear_region(top, bot, left, right) {
        for (let i = top; i < bot + 1; i++) {
            for (let j = left; j < right + 1; j++) {
                this.cells[i][j] = ' ';
            }
        }
    }


    bufferFlush(buffer, exModeInput) {
        if (this.row === this.exCommandRowNumber && this.mode === 'normal') {
            exModeInput.show();
            exModeInput.editor.setText(this.cells[this.exCommandRowNumber].join(''));
        } else {
            exModeInput.hide();
            buffer.editor.setCursorBufferPosition([this.row, this.col]);
        }
        if (this.modifiedRange) {
            const [start, end] = this.modifiedRange;
            const rows = [];
            for (let i = start[0]; i <= end[0]; i++) {
                const lineX = i === start[0] ? start[1] : 0;
                if (i === end[0]) {
                    rows.push(this.cells[i].slice(lineX, end[1]).join(''));
                } else {
                    rows.push(this.cells[i].slice(lineX).join(''));
                }
            }
            const text = rows.join("\n");
            buffer.editor.setTextInBufferRange(this.modifiedRange, text);
            this.modifiedRange = null;
        }
    }

}
