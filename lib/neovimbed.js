'use babel';
/* @flow */
// https://github.com/neovim/neovim/issues/2224
// https://github.com/neovim/node-client/blob/4f4532408019407472d481445997cfb0b5c79905/index.d.ts
import { CompositeDisposable } from 'atom';
import { attach } from 'promised-neovim-client';
import { Function as LoopholeFunction } from 'loophole';
import { spawn, ChildProcess } from 'child_process';
import NeovimBridge from './NeovimBridge';

export default {

    nvim: null,

    bindNeovimProcessHandlers(nvimProcess: ChildProcess) {
        nvimProcess.on('error', error => {
            let message = 'The neovim process received an error.';
            if (!this.nvim) {
                message = 'neovim failed to start. Do you have neovim installed?';
                message += "\nVisit https://github.com/neovim/neovim/wiki/Installing-Neovim for installation instructions.";
            }
            atom.notifications.addError(
                message,
                {
                    dismissable: true,
                    detail: error,
                }
            );
        });
        nvimProcess.on('exit', () => {
            atom.notifications.addError(
                'neovim unexpectedly terminated. It may have crashed or was sent a termination signal.',
                {
                    dismissable: true,
                    detail: 'You will need to restart atom to continue using neovim',
                }
            );
        });
    },

    async calculateWindowGridSize() : Promise {
        let editor:?atom$TextEditor = atom.workspace.getActiveTextEditor();
        if (editor == null) {
            editor = await atom.workspace.open('');
            if (editor == null) {
                throw new Error('Could not calculate size');
            }
        }
        const cellWidth = editor.getDefaultCharWidth();
        const cellHeight = editor.getLineHeightInPixels();
        const [width, height] = atom.getCurrentWindow().getSize();

        if (true || atom.inSpecMode()) {
            return {
                gridColumnCount: 120,
                gridRowCount: 10,
            };
        }

        return {
            gridColumnCount: Math.ceil(width / cellWidth),
            gridRowCount: Math.ceil(height / cellHeight),
        };
    },

    activate(state:Object) {
        const USE_SOCKET = !!process.env.NEOVIMBED_USE_SOCKET;
        const SOCKET = process.env.NEOVIMBED_SOCKET_PATH || '/tmp/nvim';

        this.initialisationPromise = this.initialise(USE_SOCKET, SOCKET);
    },

    async initialise(useSocket = false, socketPath = null) {
        const { gridRowCount, gridColumnCount } = await this.calculateWindowGridSize();

        const previousFunction = global.Function;
        // To avoid unsafe-eval errors we need to monkey patch global Function
        // object (Function is used by promised-neovim-client attach function)
        global.Function = LoopholeFunction;
        // TODO: This should be a configuration option 
        try {
            if (!useSocket) {
                const userConfig = null;//'~/.config/nvim/atom.vim'
                const nvimProcess = spawn('/usr/local/bin/nvim', ['-u', userConfig || 'NONE', '--embed'], {});
                this.bindNeovimProcessHandlers(nvimProcess);
                this.nvim = await attach(nvimProcess.stdin, nvimProcess.stdout);
            } else {
                const client = require('net').connect({path: socketPath});
                this.nvim = await attach(client, client);
            }
        } catch (e) {
            atom.notifications.addError(
                'Failed to attach to neovim process',
                {
                    dismissable: true,
                    detail: e,
                }
            );
            return;
        }
        window.nvim = this.nvim;
        atom.notifications.addSuccess('Neovim activated');
            // We can now restore global Function
        global.Function = previousFunction;

        this.neovimBridge = new NeovimBridge(this.nvim, gridColumnCount, gridRowCount);
        return this.neovimBridge.initialise();
    },

    deactivate() {
        this.neovimBridge.close();
    }


}
