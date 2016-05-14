'use babel';
    
export default class Screen {


    // Dimensions of screen
    rows = null;
    cols = null;

    // Current cursor position
    row = null;
    col = null;

    text = [];

    modifiedRange = null;

    constructor(cols, rows) {
        this.rows = rows;
        this.cols = cols;
        for (let i = 0; i < this.rows; i++) {
            this.text[i] = [];
            for (let j = 0; j < this.cols; j++) {
                this.text[i][j] = ' ';
            }
        }
    }

    cursor_goto(row, col) {
        this.row = row;
        this.col = col;
    }

    eol_clear() {
        for (let i = this.col; i < this.text[this.row].length; i++) {
            this.text[this.row][i] = ' ';
        }
        if (!this.modifiedRange) {
            this.modifiedRange = [[this.row, this.col]];
        }
        this.modifiedRange[1] = [this.row, this.text[this.row].length];
    }

    put(text, attrs) {
        // Temporary; ignore status bar updates for now
        if (this.row >= (this.rows - 1)) {
            this.text[this.row][this.col] = text;
            this.col++;
            return;
        }

        if (!this.modifiedRange) {
            this.modifiedRange = [[this.row, this.col]];
        }

        this.text[this.row][this.col] = text;
        this.col++;

        this.modifiedRange[1] = [this.row, this.col]
    }

    mode_change(mode) {
        this.mode = mode;
    }

    bufferFlush(buffer, exModeInput) {
        if (this.row === 79 && this.mode === 'normal') {
            console.log(this.text[79]);
            exModeInput.show();
            exModeInput.editor.setText(this.text[79].join(''));
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
                    rows.push(this.text[i].slice(lineX, end[1]).join(''));
                } else {
                    rows.push(this.text[i].slice(lineX).join(''));
                }
            }
            const text = rows.join("\n");
            buffer.editor.setTextInBufferRange(this.modifiedRange, text);
            this.modifiedRange = null;
        }
    }

}
