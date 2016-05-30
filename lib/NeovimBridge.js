'use babel';
/* @flow */
import { Disposable, CompositeDisposable } from 'atom';
import { oneLine } from 'common-tags'
import type { Nvim } from 'promised-neovim-client';

import LegacyVirtualWindowManager from './LegacyVirtualWindowManager';

import type { BufferDetails, VirtualWindowManager, GridSize } from './types';

export default class NeovimBridge {

    windowManager: VirtualWindowManager;
    client: Nvim;
    gridSize: GridSize;
    subscriptions: CompositeDisposable;

    constructor(client: Nvim, gridColumnCount: number, gridRowCount: number) {
        this.client = client;
        this.gridSize = { rows: gridRowCount, columns: gridColumnCount };
        this.subscriptions = new CompositeDisposable();
        this.subscriptions.add(this.addStylesheet());
        this.enableBlockCursor();
        this.windowManager = new LegacyVirtualWindowManager(this.client, this.gridSize);
        this.windowManager.onModeChange((from, to) => {
            if (to === 'insert') {
                this.disableBlockCursor();
            } else {
                this.enableBlockCursor();
            }
        });
    }

    disableBlockCursor() {
        this.style.innerHTML = '';
    }

    enableBlockCursor() {
        this.style.innerHTML = `
atom-text-editor::shadow .cursors .cursor {
  opacity: 0.8;
  color: transparent;
  background-color: #528bff;
}
        `;
    }

    addStylesheet() {
        const style = document.createElement('style');
        style.type = 'text/css';
        document.querySelector('head atom-styles').appendChild(style);

        this.style = style;
        return new Disposable(() => {
            style.parentNode.removeChild(style);
            this.style = null;
        });
    }

    initialise() : Promise {
        return this.initialiseNeovim().then(this.initialiseAtom.bind(this));
    }

    async readBuffer(details:BufferDetails) {
        // console.log('buf-read', details.bufferNumber, details);
        this.windowManager.onReadBuffer(details);
    }

    async newFileBuffer(details:BufferDetails) {
        // console.log('buf-new-file', details.bufferNumber, details);
    }

    async newEmptyBuffer(details:BufferDetails) {
        // console.log('buf-new', details.bufferNumber, details);
    }

    async deleteBuffer(details:BufferDetails) {
        // console.log('buf-delete', details.bufferNumber, details);
    }

    async initialiseNeovim() {
        await this.client.uiAttach(this.gridSize.columns, this.gridSize.rows, true);

        // Disable line numbers so that we don't receive them in ui
        // notifications
        // TODO: Sign column will cause problems too I believe?
        await this.client.command('se nonu');
        await this.client.command('se norelativenumber');
        await this.client.command('se hidden');
        await this.client.command('se nomore');
        await this.client.command('se nowrap');
        // $FlowIgnore
        if (!atom.inSpecMode() && atom.workspace.project.rootDirectories.length) {
            // Set neovim pwd to directory based on current workspace
            await this.client.command(`cd ${atom.workspace.project.rootDirectories[0].path}`);
        }
        await this.client.command(`source ${__dirname}/vim-helpers.vim`);
        await this.client.command('autocmd BufRead * call rpcnotify(0, "buf-read", [bufwinnr(""), bufnr(""), bufname(bufnr(""))], expand("%:p"))')
        await this.client.command('autocmd BufNewFile * call rpcnotify(0, "buf-new-file", [bufwinnr(""), bufnr(""), bufname(bufnr(""))], expand("%:p"))')
        await this.client.command('autocmd BufAdd * call neovimbed.NotifyIfNewEmptyBuffer("buf-add-empty")')
        await this.client.command('autocmd BufDelete * call rpcnotify(0, "buf-delete", [bufwinnr(""), bufnr(""), bufname(bufnr(""))], expand("%:p"))')
        await this.client.command('autocmd BufEnter * call rpcnotify(0, "buf-enter", [bufwinnr(""), bufnr(""), bufname(bufnr(""))], expand("%:p"))')
        await this.client.command('autocmd BufWritePost * call rpcnotify(0, "buf-write-post", [bufwinnr(""), bufnr(""), bufname(bufnr(""))], expand("%:p"))')
        await this.client.subscribe('buf-enter');
        await this.client.subscribe('buf-read');
        await this.client.subscribe('buf-new-file');
        await this.client.subscribe('buf-add-empty');
        await this.client.subscribe('buf-delete');
        await this.client.subscribe('buf-write-post');

        this.client.on('notification', (method, args) => {
            switch (method) {
                case 'buf-enter':
                    const [windowNumber, bufferNumber, bufferName] = args[0];
                    const path = args[1];
                    const details = { windowNumber, bufferNumber, bufferName, path };
                    this.windowManager.onEnterBuffer(details);
                    break;
                case 'redraw':
                    this.windowManager.redraw(args);
                    break;
                case 'buf-read': {
                    const [windowNumber, bufferNumber, bufferName] = args[0];
                    const path = args[1];
                    const details = { windowNumber, bufferNumber, bufferName, path };
                    this.readBuffer(details);
                    break;
                }
                case 'buf-new-file': {
                    const [windowNumber, bufferNumber, bufferName] = args[0];
                    const details = { windowNumber, bufferNumber, bufferName, path: null };
                    this.newFileBuffer(details);
                    break;
                }
                case 'buf-add-empty': {
                    const [windowNumber, bufferNumber, bufferName] = args[0];
                    const details = { windowNumber, bufferNumber, bufferName, path: null };
                    this.newEmptyBuffer(details);
                    break;
                }
                case 'buf-delete': {
                    const [windowNumber, bufferNumber, bufferName] = args[0];
                    const details = { windowNumber, bufferNumber, bufferName, path: null };
                    this.deleteBuffer(details);
                    break;
                }
                case 'buf-write-post': {
                    const [windowNumber, bufferNumber, bufferName] = args[0];
                    const path = args[1];
                    const details = { windowNumber, bufferNumber, bufferName, path: path };
                    console.log('post write', details);
                    this.windowManager.onBufferWritePost(details);
                    break;
                }
            }
        });

        await this.windowManager.initialise();
    }

    initialiseAtom() {
        this.subscriptions.add(atom.workspace.onDidChangeActivePaneItem((item:mixed) => {
            this.windowManager.onActivePaneItem(item);
        }));

        // $FlowIgnore 
        this.subscriptions.add(atom.workspace.observePanes((pane:atom$Pane) => {
            this.windowManager.onAddPane(pane);
            // $FlowIgnore 
            this.subscriptions.add(pane.onWillRemoveItem((details:Object) => {
                const { item, moved } = details;
                // $FlowIgnore 
                if (atom.workspace.isTextEditor(item)) {
                   this.windowManager.onRemoveTextEditor(pane, item, moved); 
                }
            }));
            // $FlowIgnore 
            this.subscriptions.add(pane.observeItems((item:Object) => {
                // $FlowIgnore 
                if (atom.workspace.isTextEditor(item)) {
                    this.windowManager.onAddTextEditor(pane, item); 
                }
            }));
        }));

        this.subscriptions.add(atom.workspace.observeTextEditors((editor:TextEditor) => {
            this.subscriptions.add(editor.onDidChangeCursorPosition((cursor) => {
                this.windowManager.onDidChangeCursorPosition(editor, cursor);
            }));
            this.subscriptions.add(editor.getBuffer().onDidChange((event) => {
                this.windowManager.onDidBufferChange(editor, event);
            }));
            this.subscriptions.add(editor.getBuffer().onDidStopChanging((event) => {
                this.windowManager.onDidBufferStopChanging(editor);
            }));
            this.subscriptions.add(editor.getBuffer().onDidSave((event) => {
                atom.notifications.addWarning(
                    oneLine`
                    You atom buffer was saved externally to neovim. This probably means your
                    neovim buffer is unsaved and it's content may not match exactly what was
                    saved. You may wish to force a save so that what's in neovim is written
                    to file - do this by pressing <strong>:w!</strong>. To see exactly
                    what is in neovim buffer open the developer console and type
                    <strong>neovim.printNvimBuffer()</strong>
                    `,
                    {
                        dismissable: true,
                    }
                );
            }));
            this.subscriptions.add(editor.onWillInsertText((event) => {
                // Prevent text insertion from happening directly (eg. pasting)
                // and send it through for neovim to handle
                this.client.input(event.text);
                event.cancel();
            }));
        }));

    }

    /**
    * Called on plugin deactivation
    */
    close() {
        this.subscriptions.dispose();
        this.client.command('qa!');
    }

}
