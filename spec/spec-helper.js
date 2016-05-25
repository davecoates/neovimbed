'use babel';


export function loadFile(path) {
    return window.nvim.command(`e ${path}`);
}

export async function loadFileGetBufferContents(path) {
    await loadFile(path);
    const buffer = await window.nvim.getCurrentBuffer();
    const lineCount = await buffer.lineCount();
    return await buffer.getLineSlice(0, lineCount, true, true);
}

export function timeout(ms = 50) {
    return new Promise(resolve => jasmine.setTimeout(resolve, ms));
}

export function waitsForTimeout(ms = 50) {
    return waitsForPromise(() => timeout(ms));
}

export function getActivationPromise() {
    return atom.packages.activatePackage('neovimbed').then(async package => {
        atom.workspace.destroyActivePaneItem();
        await package.mainModule.initialisationPromise;
        window.nvim = package.mainModule.nvim;
        // TODO: This may be a bad idea and it's actually something that
        // should be handled and have test cases for
        await window.nvim.command('set noswapfile');
        return package.mainModule;
    });
}

export async function getBufferContents(bufferNumber) {
    const buffers = await window.nvim.getBuffers();
    for (const buffer of buffers) {
        const n = await buffer.getNumber();
        if (n === bufferNumber) {
            const lineCount = await buffer.lineCount();
            return await buffer.getLineSlice(0, lineCount, true, true);
        }
    }
    throw new Error(`Could not find buffer ${bufferNumber}`);
}
