'use babel';
// Taken from https://github.com/rhysd/neovim-component/blob/master/src/neovim/input.ts
export function shouldIgnoreOnKeydown(event) {
    const {metaKey, ctrlKey, shiftKey, altKey, keyCode} = event;
    return metaKey || shiftKey && keyCode === 16 ||
        ctrlKey && keyCode === 17 ||
        altKey && keyCode === 18;
}

// Note:
// Workaround when KeyboardEvent.key is not available.
function getVimSpecialCharFromKeyCode(keyCode, shift) {
    switch (keyCode) {
        case 0:   return 'Nul';
        case 8:   return 'BS';
        case 9:   return 'Tab';
        case 10:  return 'NL';
        case 13:  return 'CR';
        case 33:  return 'PageUp';
        case 34:  return 'PageDown';
        case 27:  return 'Esc';
        case 32:  return 'Space';
        case 35:  return 'End';
        case 36:  return 'Home';
        case 37:  return 'Left';
        case 38:  return 'Up';
        case 39:  return 'Right';
        case 40:  return 'Down';
        case 45:  return 'Insert';
        case 46:  return 'Del';
        case 47:  return 'Help';
        case 92:  return 'Bslash';
        case 112: return 'F1';
        case 113: return 'F2';
        case 114: return 'F3';
        case 115: return 'F4';
        case 116: return 'F5';
        case 117: return 'F6';
        case 118: return 'F7';
        case 119: return 'F8';
        case 120: return 'F9';
        case 121: return 'F10';
        case 122: return 'F11';
        case 123: return 'F12';
        case 124: return 'Bar'; // XXX
        case 127: return 'Del'; // XXX
        case 188: return shift ? 'LT' : null;
        default:  return null;
    }
}

export function getVimSpecialCharInput(event) {
    const specialChar = getVimSpecialCharFromKeyCode(event.keyCode, event.shiftKey);
    if (!specialChar) {
        return null;
    }

    let vimInput = '<';
    if (event.ctrlKey) {
        vimInput += 'C-';
    }
    if (event.altKey) {
        vimInput += 'A-';
    }
    // Note: <LT> is a special case where shift should not be handled.
    if (event.shiftKey && specialChar !== 'LT') {
        vimInput += 'S-';
    }
    vimInput += specialChar + '>';
    return vimInput;
}

const keyCodeToKey = {
    // Second element is with shift on
    48: ['0', ')'],
    49: ['1', '!'],
    50: ['2', '@'],
    51: ['3', '#'],
    52: ['4', '$'],
    53: ['5', '%'],
    54: ['6', '^'],
    55: ['7', '&'],
    56: ['8', '*'],
    57: ['9', '('],
    186: [';', ':'],
    187: ['=', '+'],
    188: [',', 'lt'],
    189: ['-', '_'],
    190: ['.', '>'],
    191: ['/', '?'],
    192: ['`', '~'],
    219: ['[', '{'],
    220: ['\\', '|'],
    221: [']', '}'],
    222: ["'", '"'],
};

export function getVimInputFromKeyCode(event) {
    let modifiers = '';
    if (event.ctrlKey) {
        modifiers += 'C-';
    }
    if (event.altKey) {
        modifiers += 'A-';
    }
        // Note: <LT> is a special case where shift should not be handled.
    if (event.shiftKey) {
        modifiers += 'S-';
    }
    let vimInput;
    if (keyCodeToKey[event.keyCode]) {
        // Convert these based on shift - passing <S-]> gave different results
        // than passing <S-}>, eg. f<S-]> found ] rather than }
        vimInput = keyCodeToKey[event.keyCode][event.shiftKey ? 1 : 0];
        if (modifiers == 'S-') modifiers = '';
    } else if (event.keyCode >= 65 && event.keyCode <= 90) {
        vimInput = String.fromCharCode(event.keyCode);
        if (!event.shiftKey) {
            vimInput = vimInput.toLowerCase();
        } else if (modifiers == 'S-') {
            modifiers = '';
        }
    } else {
        vimInput = String.fromCharCode(event.keyCode);
    }
    if (modifiers !== '') {
        vimInput = `<${modifiers}${vimInput}>`;
    }
    return vimInput;
}
