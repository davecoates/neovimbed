'use babel'
import {shouldIgnoreOnKeydown, getVimSpecialCharInput, getVimInputFromKeyCode} from './input';

export default class Buffer {

    name:?string;
    number:?number;

    initialised = false;

    constructor(nvim, editor) {
        const view = atom.views.getView(editor);
        view.addEventListener('keydown', this.onKeyDown);
        this.nvim = nvim;
        this.editor = editor;
        this.init();
    }

    onKeyDown = (e) => {
        const specialSequence = getVimSpecialCharInput(e);
        if (shouldIgnoreOnKeydown(e)) {
            return false;
        }
        e.stopPropagation();
        e.preventDefault();
        const input = specialSequence == null ? getVimInputFromKeyCode(e) : specialSequence;
        this.nvim.input(input)

        return false;
    }

    async init() {
        const uri = this.editor.getURI();
        if (!uri) return;
        this.name = this.editor.getURI()
        // If URI is set open that file otherwise start a new buffer
        // TODO: Currently this fails for unsaved buffers that are open already
        // in atom - when you subsequently open another file it replaces the
        // unnamed buffer
        try {
            await this.nvim.command(uri ? `e ${uri}` : 'enew');
        } catch (e) {
            // E325: ATTENTION is start of string when you have a swap file
            // We only receive this message after a decision has been made
            // about what to do. Safe to proceed with initialisation if this
            // is the error.
            if (!e.message.match(/E325: ATTENTION/)) {
                console.error(`Unexpected error opening file '${uri}'`, e);
                return;
            }
        }

        this.initialised = true;
        // Match the opened buffer so we can get the buffer number 
        const buffers = await this.nvim.getBuffers();
        for (let buffer of buffers) {
            let name = await buffer.getName();
            if (name === uri) {
                this.name = name;
                this.number = await buffer.getNumber();
                this.lineCount = await buffer.lineCount();
                const lines = await buffer.getLineSlice(0, this.lineCount, true, true);
                this.editor.setText(lines.join("\n"));
                console.info(`Initialised ${this.name} (${this.number})`);
                return;
            }
        }
        console.error(`Failed to match buffer for editor with URI ${uri}`);
    }


}
