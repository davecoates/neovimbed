'use babel';
/* @flow */
import type { Nvim, Window as VimWindow } from 'promised-neovim-client';

export type RedrawMethod = 'put' | 'eol_clear' | 'highlight_set' | 'cursor_goto' | 'mode_change' | 'scroll' | 'set_scroll_region' | 'clear_region';
export type RedrawMethodParams = Array<any>;
export type RedrawUpdate = [RedrawMethod, RedrawMethodParams];
export type RedrawUpdates = Array<RedrawUpdate>;
export type GridSize = {
    columns: number;
    rows: number;
};


export type BufferDetails = {
    windowNumber: number;
    bufferNumber: number;
    bufferName: string;
    path: ?string;
}


export interface VirtualWindow {

    pane: atom$Pane;
    remoteWindow: VimWindow;

}

export interface VirtualWindowManager {

    constructor(client: Nvim, gridSize: GridSize) : void;

    onReadBuffer(buffer:BufferDetails) : Promise;

    onNewFileBuffer(buffer:BufferDetails) : Promise;

    onNewEmptyBuffer(buffer:BufferDetails) : Promise;

    onDeleteBuffer(buffer:BufferDetails) : Promise;

    onAddPane(pane: atom$Pane) : Promise;

    onActivePaneItem(item: mixed) : Promise;

    onAddTextEditor(pane: atom$Pane, editor: atom$TextEditor) : void;

    /**
     * @param {Boolean} moved true if text editor was moved to another pane
     */
    onRemoveTextEditor(pane: atom$Pane, editor: atom$TextEditor, moved: boolean) : void;

    onRemovePane(pane: atom$Pane) : void;

    redraw(updates:RedrawUpdates) : void;

    exit() : void;

}

export interface InputHandler {

    constructor(client: Nvim) : void;

    onKeyDown(e: KeyboardEvent) : void;

    onMouseDown(e: MouseEvent) : void;

    onMouseMove(e: MouseEvent) : void;

    onMouseRelease(e: MouseEvent) : void;

}
