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
    }

    put(text, attrs) {
        if (this.row > 78) return;
        if (!this.modifiedRange) {
            this.modifiedRange = [[this.row, this.col]];
        }
        this.text[this.row][this.col] = text;
        this.col++;
        this.modifiedRange[1] = [this.row, this.col]
    }

    bufferFlush(buffer) {
        if (this.modifiedRange) {
            buffer.editor.setCursorBufferPosition([this.row, this.col]);
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
