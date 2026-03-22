"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const session_expiry_policy_js_1 = require("../src/lib/auth/session-expiry-policy.js");
let failed = 0;
async function run(name, fn) {
    try {
        await fn();
        console.log(`PASS ${name}`);
    }
    catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error?.stack || error);
    }
}
async function main() {
    await run('refresh bootstrap with a valid restoring session does not force reauthenticate', () => {
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDispatchSessionExpiry)({
            status: 401,
            runtimeState: 'RESTORING',
            isOnline: true,
        }), false);
    });
    await run('offline state does not trigger reauthenticate for a cached signed-in user', () => {
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDispatchSessionExpiry)({
            status: 401,
            runtimeState: 'AUTHENTICATED',
            isOnline: false,
        }), false);
    });
    await run('forbidden responses do not masquerade as expired sessions', () => {
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDispatchSessionExpiry)({
            status: 403,
            runtimeState: 'AUTHENTICATED',
            isOnline: true,
        }), false);
    });
    await run('real online 401 failures still surface reauthentication', () => {
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDispatchSessionExpiry)({
            status: 401,
            runtimeState: 'AUTHENTICATED',
            isOnline: true,
        }), true);
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
