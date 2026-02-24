/**
 * Shared utilities — re-exports from validators + JSON extraction.
 */

export {deterministicValidation} from './validators/structural.js';
export {
    inputCoverageValidation, validateAssertCoverage, loadComponentSchema, getInputSchema
} from './validators/coverage.js';

export const extractJSON = (text) => {
    for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
        try {
            return JSON.parse(match[1].trim());
        } catch { /* continue */
        }
    }
    try {
        return JSON.parse(text.trim());
    } catch { /* continue */
    }
    let depth = 0, start = -1;
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (text[i] === '}') {
            depth--;
            if (depth === 0 && start !== -1) {
                try {
                    return JSON.parse(text.slice(start, i + 1));
                } catch {
                    start = -1;
                }
            }
        }
    }
    return null;
};
