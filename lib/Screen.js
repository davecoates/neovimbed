/* @flow */
import type { GridSize } from './types';

import { range } from './util';

type CursorPosition = {
    row: number;
    col: number;
};

    
export default class Screen {

    gridSize: GridSize;

    cursor: CursorPosition = {
        row: 0,
        col: 0,
    };

    top = 0;
    bottom = 0;
    left = 0;
    right = 0;

    selectedRegion = null;

    // rows x cols array, each element in nested array a character
    cells = [];

    constructor(gridSize, lineNumberColumns) {
        this.gridSize;
        this.lineNumberColumns = lineNumberColumns;
        this.gridSize = gridSize;
        this.top = 0
        this.bot = this.gridSize.rows - 1
        this.left = 0
        this.right = this.gridSize.columns - 1

        this.exCommandRowNumber = this.gridSize.rows - 1;
        this.statusBarRowNumber = this.gridSize.rows - 2;
        for (let i = 0; i < this.gridSize.rows; i++) {
            this.cells[i] = [];
            for (let j = 0; j < this.gridSize.columns; j++) {
                this.cells[i][j] = ' ';
            }
        }
    }

    /**
     * Expand any selections when in visual or visual block mode based on
     * current cursor position
     */
    expandSelectedRegion() {
        if (this.cursor.row >= this.exCommandRowNumber) return;

        // Column is incremented by 1 to match VIM behaviour - seems to include
        // the column the cursor is now on after expanding selection
        if (this.mode === 'visual') {
            this.selectedRegion[1] = [this.cursor.row, this.cursor.col + 1];
        }
        if (this.mode === 'visual_block') {
            // We track selections in visual block line by line
            if (!this.selectedRegionsByRow[this.cursor.row]) {
                this.selectedRegionsByRow[this.cursor.row] = [this.cursor.col, this.cursor.col + 1];
            } else {
                this.selectedRegionsByRow[this.cursor.row][1] = this.cursor.col + 1;
            }
        }
    }

    cursor_goto(row, col) {
        this.cursor.row = row;
        this.cursor.col = col;
        this.expandSelectedRegion();
    }

    eol_clear() {
        for (let i = this.cursor.col; i < this.cells[this.cursor.row].length; i++) {
            this.cells[this.cursor.row][i] = ' ';
        }
    }

    put(text) {
        // Temporary; ignore status bar updates for now
        if (this.cursor.row == this.exCommandRowNumber) {
            this.cells[this.cursor.row][this.cursor.col] = text;
            this.cursor.col++;
            this.expandSelectedRegion();
            return;
        }

        this.cells[this.cursor.row][this.cursor.col] = text;
        this.cursor.col++;
        this.expandSelectedRegion();
    }

    mode_change(mode) {
        this.mode = mode;
        if (mode === 'visual') {
            this.selectedRegion = [[this.cursor.row, this.cursor.col], [this.cursor.row, this.cursor.col + 1]];
            this.selectedRegionsByRow = null;
        } else if (mode === 'visual_block') {
            this.selectedRegionsByRow = {
                [this.cursor.row]: [this.cursor.col, this.cursor.col + 1],
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
    }

    clear() {
        this.clear_region(this.top, this.bot, this.left, this.right)
    }

    clear_region(top, bot, left, right) {
        for (let i = top; i < bot + 1; i++) {
            for (let j = left; j < right + 1; j++) {
                this.cells[i][j] = ' ';
            }
        }
    }

    getCursorPosition() {
        return [this.cursor.row + this.getOffsetLine(), this.cursor.col - this.lineNumberColumns];
    }

    getOffsetLine() {
        return Number(this.cells[0].slice(0, this.lineNumberColumns).join('')) - 1;
    }

    flush() {
        this.modifiedRange = null;
    }

}
