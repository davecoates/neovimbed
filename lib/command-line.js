/* @flow */

import type { Mode } from './types';

const modeByIndicatorString = {
    '-- VISUAL --': 'visual',
    '-- VISUAL BLOCK --': 'visual_block',
};

const indicatorStringByMode = {
    visual: '-- VISUAL --',
    visual_block: '-- VISUAL BLOCK --',
};

/**
 * Try and infer what the current mode is from the command line text. Command
 * line text is the text shown when you aren't in command line mode (mode
 * triggered by pressing ':'). For example when in visual mode it show's
 * -- VISUAL --. We can't rely on this entirely as it doesn't always show the
 *  mode so we only use it for visual modes which we do not receive
 *  notifications for (and vim itself has no autocmd's for when you enter these
 *  modes).
 */
export function inferModeFromCommandLineText(currentMode, line) : Mode{
    for (let indicator in modeByIndicatorString) {
        if (line.substr(0, indicator.length) === indicator) {
            return modeByIndicatorString[indicator];
        }
    }
    if (line[0] === ':') {
        return 'command';
    }
    if (indicatorStringByMode[currentMode]) {
        // If current mode is an inferred mode and we can no longer infer it
        // from the command line string then we assume we are back to normal
        // mode.
        return 'normal';
    }
    return currentMode;
}

