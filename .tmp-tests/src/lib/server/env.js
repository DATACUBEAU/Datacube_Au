"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.firstEnv = firstEnv;
function firstEnv(...keys) {
    for (const key of keys) {
        const value = process.env[key];
        if (value && value.trim().length > 0) {
            return value;
        }
    }
    return null;
}
