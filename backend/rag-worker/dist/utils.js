"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.deterministicChunking = deterministicChunking;
exports.computeHash = computeHash;
const crypto_1 = require("crypto");
/**
 * Deterministic chunking using a fixed character window.
 * In a real production app, you might use token-based splitting (e.g. tiktoken).
 */
function deterministicChunking(text, size = 1000, overlap = 200) {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + size, text.length);
        const chunk = text.slice(start, end);
        chunks.push(chunk);
        if (end === text.length)
            break;
        start += size - overlap;
    }
    return chunks.filter(c => c.trim().length > 0);
}
/**
 * Computes MD5 hash of a string.
 */
function computeHash(text) {
    return (0, crypto_1.createHash)('md5').update(text).digest('hex');
}
/**
 * Structured logger
 */
exports.logger = {
    info: (message, data) => {
        console.log(JSON.stringify({ level: 'info', message, timestamp: new Date().toISOString(), ...data }));
    },
    warn: (message, data) => {
        console.warn(JSON.stringify({ level: 'warn', message, timestamp: new Date().toISOString(), ...data }));
    },
    error: (message, error) => {
        console.error(JSON.stringify({
            level: 'error',
            message,
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined
        }));
    }
};
