'use babel';

import Neovimbed from '../lib/neovimbed';
import { keyCodeToKeyWithShift } from '../lib/input';
import { loadFile, loadFileGetBufferContents, getBufferContents, waitsForTimeout, getActivationPromise } from './spec-helper';
import fs from 'fs';

// process.env.NEOVIMBED_USE_SOCKET = true;

function sendKeys(str) {
    // Bypass event system and just pass straight through to input. Working out
    // keycode is a pain.
    window.nvim.input(str);
}

/**
 * If last line is empty assume it was an added new line and return new array with
 * that one removed
 */
function trimTrailingNewline(lines) {
    if (lines.length && lines[lines.length - 1] === '') {
        return lines.slice(0, lines.length - 1);
    }
    return lines;
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
            waitsForTimeout();

            runs(async () => {
                const textEditors = atom.workspace.getTextEditors();
                expect(textEditors.length).toBe(1);
                const lines = textEditors[0].getBuffer().lines;
                const text = ["Hello everyone there", "line 2"];
                expect(bufferContents).toEqual(text);
                expect(lines.map(line => line.replace(/[ ]+$/, ''))).toEqual(text);
            });

        });

        it('basic motion, remove characters', () => {
            waitsForPromise(() => activationPromise);

            let bufferContents;
            waitsForPromise(() => loadFile(__dirname + '/fixtures/file.txt'));
            waitsForTimeout();
            waitsForPromise(async () => {
                sendKeys('ggcw');
                bufferContents = await getBufferContents(1);
            });

            runs(() => {
                const textEditors = atom.workspace.getTextEditors();
                expect(textEditors.length).toBe(1);
                const lines = textEditors[0].getBuffer().lines;
                const text = [" there", "line 2"];
                expect(bufferContents).toEqual(text);
                expect(lines.map(line => line.replace(/[ ]+$/, ''))).toEqual(text);
            });

        });

        it('scroll screen', () => {
            waitsForPromise(() => activationPromise);

            const path = __dirname + '/fixtures/fn.js';
            const fileContents = fs.readFileSync(path, { encoding: 'utf8' });
            let bufferContents;
            waitsForPromise(() => loadFile(path));
            waitsForTimeout();
            waitsForPromise(async () => {
                sendKeys('6j');
                bufferContents = await getBufferContents(1);
            });

            runs(() => {
                const textEditors = atom.workspace.getTextEditors();
                expect(textEditors.length).toBe(1);
                const lines = trimTrailingNewline(textEditors[0].getBuffer().lines);
                const text = fileContents.replace(/\n*$/,'').split("\n");
                const textLines = text;
                expect(bufferContents).toEqual(text);
                expect(lines.length).toEqual(textLines.length);
                expect(lines.map(line => line.replace(/[ ]+$/, ''))).toEqual(textLines);
            });

        });

        it('delete block with bottom section off visible screen', () => {
            waitsForPromise(() => activationPromise);

            const path = __dirname + '/fixtures/fn.js';
            let bufferContents;
            waitsForPromise(() => loadFile(path));
            waitsForTimeout();
            waitsForPromise(async () => {
                sendKeys('jdi{');
                bufferContents = await getBufferContents(1);
            });
            runs(() => {
                const textEditors = atom.workspace.getTextEditors();
                expect(textEditors.length).toBe(1);
                const lines = textEditors[0].getBuffer().lines;
                expect(lines.map(line => line.replace(/[ ]+$/, ''))).toEqual(bufferContents);
            });
        });

        it('jump off screen', () => {
            waitsForPromise(() => activationPromise);

            const path = __dirname + '/fixtures/fn.js';
            let bufferContents;
            waitsForPromise(() => loadFile(path));
            waitsForTimeout();
            waitsForPromise(async () => {
                sendKeys('G');
                bufferContents = await getBufferContents(1);
            });
            runs(() => {
                const textEditors = atom.workspace.getTextEditors();
                expect(textEditors.length).toBe(1);
                const lines = trimTrailingNewline(textEditors[0].getBuffer().lines);
                console.log(bufferContents.join("\n"));
                console.log(lines.map(line => line.replace(/[ ]+$/, '')).join("\n"));
                expect(lines.map(line => line.replace(/[ ]+$/, ''))).toEqual(bufferContents);
            });
        });

        it('delete block with bottom section off visible screen, undo', () => {
            waitsForPromise(() => activationPromise);

            const path = __dirname + '/fixtures/fn.js';
            let bufferContents;
            waitsForPromise(() => loadFile(path));
            waitsForTimeout();
            waitsForPromise(async () => {
                sendKeys('jdi{u');
                bufferContents = await getBufferContents(1);
            });
            runs(() => {
                const textEditors = atom.workspace.getTextEditors();
                expect(textEditors.length).toBe(1);
                const lines = trimTrailingNewline(textEditors[0].getBuffer().lines);
                expect(lines.map(line => line.replace(/[ ]+$/, ''))).toEqual(bufferContents);
            });
        });

        it('replace text offscreen', () => {
            waitsForPromise(() => activationPromise);

            const path = __dirname + '/fixtures/fn.js';
            let bufferContents;
            waitsForPromise(() => loadFile(path));
            waitsForTimeout();
            waitsForPromise(async () => {
                sendKeys(':%s/i/I/g<cr>');
                bufferContents = await getBufferContents(1);
            });
            runs(() => {
                const textEditors = atom.workspace.getTextEditors();
                expect(textEditors.length).toBe(1);
                const lines = trimTrailingNewline(textEditors[0].getBuffer().lines);
                expect(lines.map(line => line.replace(/[ ]+$/, ''))).toEqual(bufferContents);
            });
        });
    });

});
