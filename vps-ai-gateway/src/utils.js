"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.parsePositiveInt = parsePositiveInt;
exports.firstEnv = firstEnv;
exports.getOpenRouterKey = getOpenRouterKey;
exports.getAnthropicKey = getAnthropicKey;
exports.sleep = sleep;
exports.logger = {
    info: (msg, ...args) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`, ...args),
    debug: (msg, ...args) => {
        if (process.env.DEBUG === '1')
            console.log(`[DEBUG] ${new Date().toISOString()} ${msg}`, ...args);
    },
};
function parsePositiveInt(raw, fallback) {
    const parsed = Number(raw ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return Math.floor(parsed);
}
function firstEnv(...keys) {
    for (const key of keys) {
        const value = process.env[key];
        if (value && value.trim().length > 0)
            return value;
    }
    return null;
}
function getOpenRouterKey() {
    return firstEnv('OPENROUTER_API_KEY', 'OPENAI_API_KEY');
}
function getAnthropicKey() {
    return firstEnv('ANTHROPIC_API_KEY');
}
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
