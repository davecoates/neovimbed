'use babel';
// https://github.com/neovim/neovim/issues/2224
// https://github.com/neovim/node-client/blob/4f4532408019407472d481445997cfb0b5c79905/index.d.ts

import { CompositeDisposable } from 'atom';
import { Function as LoopholeFunction } from 'loophole';
import { attach } from 'promised-neovim-client';
import { spawn } from 'child_process';
import Buffer from './Buffer';
import ExCommandModeBuffer from './ExCommandModeBuffer';
import Screen from './Screen';
import ExModeCommandInputElement  from './ExModeCommandInputElement';


class Neovimbed {

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
    }

    nvim: null;

    subscriptions: null;

    activeBuffer = null;
    activeBufferNumber = null;
    activeBufferName = null;
    buffers = [];

    getActiveBuffer() {
        if ((this.activeBuffer || {}).number !== this.activeBufferNumber) {
            for (let buffer of this.buffers) {
                if (!buffer.initialised) {
                    if (buffer.name === this.activeBufferName) {
                        this.activeBuffer = buffer;
                        break;
                    }
                } else if (buffer.number === this.activeBufferNumber) {
                    this.activeBuffer = buffer;
                    break;
                }
            }
        }
        if (this.activeBuffer) {
            return this.activeBuffer;
        }
        return this.buffers[0];
    }

    async activate(state) {
        const exMode = new ExModeCommandInputElement(); 
        exMode.init();
        // TODO: Currently Screen will set input on exMode editor as needed.
        // Would be better for exMode to work like other Buffers - it could
        // then provide own handled and call nvim.command() when enter is
        // pressed so that we can handle errors. Right now passing everything
        // via nvim.input() we get no errors back. alternatively the error will
        // be output on the line so once the status line is implemented maybe
        // this will be not worth the effort.
        this.exMode = exMode;
        this.subscriptions = new CompositeDisposable();

        const previousFunction = global.Function;
            // To avoid unsafe-eval errors we need to monkey patch global Function
            // object (Function is used by promised-neovim-client attach function)
        global.Function = LoopholeFunction;
        // TODO: This should be a configuration option 
        const userConfig = null;//'~/.config/nvim/init.vim'

        const nvimProcess = spawn('nvim', ['-u', userConfig || 'NONE', '-N', '--embed'], {});
        this.bindNeovimProcessHandlers(nvimProcess);
        try {
            this.nvim = await attach(nvimProcess.stdin, nvimProcess.stdout);
        } catch (e) {
            atom.notifications.addError(
                'Failed to attach to neovim process',
                {
                    dismissable: true,
                    detail: error,
                }
            );
            return;
        }
        const nvim = this.nvim;
        atom.notifications.addSuccess('Neovim activated');
            // We can now restore global Function
        global.Function = previousFunction;
        const windows = await nvim.getWindows();
        const cols = 80;
        const rows = 80;
        await nvim.uiAttach(cols, rows, true);
        this.screen = new Screen(cols, rows);

        // Disable line numbers so that we don't receive them in ui
        // notifications
        // TODO: Sign column will cause problems too I believe?
        await nvim.command('se nonu');
        await nvim.command('se norelativenumber');
        await nvim.command('se hidden');
        // Setup notifications for events we don't get from neovim ui_attach
        // protocol
        await nvim.command('autocmd BufEnter * call rpcnotify(0, "buf-enter", bufnr(""), bufname(bufnr("")))')
        await nvim.subscribe('buf-enter');


        nvim.on('notification', (method, args) => {
            if (method == 'redraw') {
                if (args.length === 0) return;
                console.groupCollapsed(`redraw ${args.length}`);
                for (const [message, ...updates] of args) {
                    if (this.screen[message]) {
                        for (const update of updates) {
                            console.log(message, ...update);
                            this.screen[message](...update);
                        }
                    } else {
                        console.log('Unhandled!', message, ...updates);
                    }
                }
                this.screen.bufferFlush(this.getActiveBuffer(), this.exMode);
                console.groupEnd();
            } else {
                if (method === 'buf-enter') {
                    const [number, name] = args;
                    this.activeBufferNumber = number;
                    this.activeBufferName = name;
                } else {
                    console.log(method);
                }
            }
        });

        this.subscriptions.add(atom.workspace.observeTextEditors((editor) => {
            const editorView = atom.views.getView(editor);
            const virtualBuffer = new Buffer(nvim, editor);
            this.buffers.push(virtualBuffer);
            if (!this.activeBuffer) {
                this.activeBuffer = virtualBuffer;
            }
        }));
    }

    deactivate() {
        console.log('deactivate', this.nvim);
        if (this.nvim) {
            this.nvim.command('qa!');
        }
        this.subscriptions.dispose();
    }

};


export default new Neovimbed();
