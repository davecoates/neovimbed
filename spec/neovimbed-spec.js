'use babel';

import Neovimbed from '../lib/neovimbed';
import { loadFile, loadFileGetBufferContents, getBufferContents, waitsForTimeout, getActivationPromise } from './spec-helper';
import getKeycode from 'keycode';

function sendKeys(str) {
    for (const c of str) {
        const view = atom.views.getView(atom.workspace.getActiveTextEditor())
        const e = atom.keymaps.constructor.buildKeydownEvent(c, { keyCode: getKeycode(c), target: view });
        view.dispatchEvent(e);
    }
}

// Use the command `window:run-package-specs` (cmd-alt-ctrl-p) to run specs.
//
// To run a specific `it` or `describe` block add an `f` to the front (e.g. `fit`
// or `fdescribe`). Remove the `f` to unfocus the block.
//
describe('Neovimbed', () => {
    let workspaceElement, activationPromise;

    beforeEach(() => {
        workspaceElement = atom.views.getView(atom.workspace);
        activationPromise = getActivationPromise();
   });

    describe('neovim buffer creation', () => {
        it('read file in neovim, reflected in TextEditor', () => {
            waitsForPromise(() => activationPromise);

            let bufferContents;
            waitsForPromise(async () => bufferContents = await loadFileGetBufferContents(__dirname + '/fixtures/file.txt'));
            waitsForTimeout();

            runs(() => {
                const textEditors = atom.workspace.getTextEditors();
                expect(textEditors.length).toBe(1);
                const lines = textEditors[0].getBuffer().lines;
                expect(lines.map(line => line.replace(/[ ]+$/, ''))).toEqual(bufferContents);
            });
        });

        it('read multiple files in neovim, reflected in multiple TextEditor', () => {
            waitsForPromise(() => activationPromise);

            let buffer1Contents, buffer2Contents;
            waitsForPromise(async () => buffer1Contents = await loadFileGetBufferContents(__dirname + '/fixtures/file.txt'));
            waitsForPromise(async () => buffer2Contents = await loadFileGetBufferContents(__dirname + '/fixtures/file2.txt'));
            waitsForTimeout();

            runs(() => {
                const textEditors = atom.workspace.getTextEditors();
                expect(textEditors.length).toBe(2);
                const lines1 = textEditors[0].getBuffer().lines;
                expect(lines1.map(line => line.replace(/[ ]+$/, ''))).toEqual(buffer1Contents);
                const lines2 = textEditors[1].getBuffer().lines;
                expect(lines2.map(line => line.replace(/[ ]+$/, ''))).toEqual(buffer2Contents);
            });
        });

        it('open file in Atom, open buffer in nvim', () => {
            waitsForPromise(() => activationPromise);

            let buffer1Contents, buffer2Contents;
            waitsForPromise(() => atom.workspace.open(__dirname + '/fixtures/file.txt'));
            waitsForPromise(() => atom.workspace.open(__dirname + '/fixtures/file2.txt'));
            waitsForTimeout();
            waitsForPromise(async () => buffer1Contents = await getBufferContents(1));
            waitsForPromise(async () => buffer2Contents = await getBufferContents(2));

            runs(() => {
                const textEditors = atom.workspace.getTextEditors();
                expect(textEditors.length).toBe(2);
                const lines1 = textEditors[0].getBuffer().lines;
                expect(lines1.map(line => line.replace(/[ ]+$/, ''))).toEqual(buffer1Contents);
                const lines2 = textEditors[1].getBuffer().lines;
                expect(lines2.map(line => line.replace(/[ ]+$/, ''))).toEqual(buffer2Contents);
            });
        });

    });


    describe('neovim basic buffer changes', () => {
        it('basic motion, insert characters', () => {
            waitsForPromise(() => activationPromise);

            let bufferContents;
            waitsForPromise(() => loadFile(__dirname + '/fixtures/file.txt'));
            waitsForTimeout();
            waitsForPromise(async () => {
                sendKeys('gg~Wieveryone ');
                bufferContents = await getBufferContents(1);
            });

            runs(async () => {
                const textEditors = atom.workspace.getTextEditors();
                expect(textEditors.length).toBe(1);
                const lines = textEditors[0].getBuffer().lines;
                const text = ["Hello everyone there", "line 2"];
                expect(bufferContents).toEqual(text);
                console.log(lines);
                expect(lines.map(line => line.replace(/[ ]+$/, ''))).toEqual(text);
            });

        });
    });

});
