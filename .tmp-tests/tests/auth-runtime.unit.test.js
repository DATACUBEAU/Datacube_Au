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
            intent: 'interactive',
        }), false);
    });
    await run('offline state does not trigger reauthenticate for a cached signed-in user', () => {
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDispatchSessionExpiry)({
            status: 401,
            runtimeState: 'AUTHENTICATED',
            isOnline: false,
            intent: 'interactive',
        }), false);
    });
    await run('forbidden responses do not masquerade as expired sessions', () => {
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDispatchSessionExpiry)({
            status: 403,
            runtimeState: 'AUTHENTICATED',
            isOnline: true,
            intent: 'interactive',
        }), false);
    });
    await run('background analytics or polling failures do not trigger reauthenticate', () => {
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDispatchSessionExpiry)({
            status: 401,
            runtimeState: 'AUTHENTICATED',
            isOnline: true,
            intent: 'background',
        }), false);
    });
    await run('bootstrap-time 401 failures do not trigger reauthenticate', () => {
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDispatchSessionExpiry)({
            status: 401,
            runtimeState: 'AUTHENTICATED',
            isOnline: true,
            intent: 'bootstrap',
        }), false);
    });
    await run('degraded backend 5xx responses do not masquerade as auth expiry', () => {
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDispatchSessionExpiry)({
            status: 503,
            runtimeState: 'AUTHENTICATED',
            isOnline: true,
            intent: 'interactive',
        }), false);
    });
    await run('real online interactive 401 failures still surface reauthentication', () => {
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDispatchSessionExpiry)({
            status: 401,
            runtimeState: 'AUTHENTICATED',
            isOnline: true,
            intent: 'interactive',
        }), true);
    });
    await run('protected background data waits for auth bootstrap to settle', () => {
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDeferProtectedRequest)({
            isAuthLoading: true,
            isAuthRestoring: false,
            isAuthLocked: false,
        }), true);
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDeferProtectedRequest)({
            isAuthLoading: false,
            isAuthRestoring: true,
            isAuthLocked: false,
        }), true);
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDeferProtectedRequest)({
            isAuthLoading: false,
            isAuthRestoring: false,
            isAuthLocked: true,
        }), true);
        strict_1.default.equal((0, session_expiry_policy_js_1.shouldDeferProtectedRequest)({
            isAuthLoading: false,
            isAuthRestoring: false,
            isAuthLocked: false,
        }), false);
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
