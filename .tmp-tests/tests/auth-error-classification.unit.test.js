"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const auth_error_classification_js_1 = require("../src/lib/auth/auth-error-classification.js");
let failed = 0;
function run(name, fn) {
    try {
        fn();
        console.log(`PASS ${name}`);
    }
    catch (error) {
        failed += 1;
        console.error(`FAIL ${name}`);
        console.error(error?.stack || error);
    }
}
run('reclassifies unauthorized catch payloads that were previously mislabeled as internal errors', () => {
    const result = (0, auth_error_classification_js_1.classifyAuthFailure)({
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'internal_server_error',
        details: 'unauthorized',
    });
    strict_1.default.ok(result);
    strict_1.default.equal(result?.status, 401);
    strict_1.default.equal(result?.code, 'UNAUTHORIZED');
    strict_1.default.equal(result?.reason, 'unauthorized');
});
run('keeps explicit forbidden errors mapped to 403', () => {
    const result = (0, auth_error_classification_js_1.classifyAuthFailure)({
        status: 403,
        code: 'TIER_ACCESS_DENIED',
        message: 'Access denied.',
        details: { reason: 'permission_denied' },
    });
    strict_1.default.ok(result);
    strict_1.default.equal(result?.status, 403);
    strict_1.default.equal(result?.code, 'FORBIDDEN');
    strict_1.default.equal(result?.reason, 'permission_denied');
    strict_1.default.equal((0, auth_error_classification_js_1.isAuthorizationFailure)(result), true);
});
run('does not classify genuine infrastructure failures as auth failures', () => {
    const result = (0, auth_error_classification_js_1.classifyAuthFailure)({
        status: 500,
        code: 'UPSTREAM_TIMEOUT',
        message: 'upstream_timeout',
        details: { timeoutMs: 120000 },
    });
    strict_1.default.equal(result, null);
    strict_1.default.equal((0, auth_error_classification_js_1.isAuthenticationFailure)(result), false);
});
if (failed > 0)
    process.exit(1);
