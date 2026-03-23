"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const payment_return_js_1 = require("../src/lib/billing/payment-return.js");
const subscription_page_state_js_1 = require("../src/lib/billing/subscription-page-state.js");
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
function readProjectFile(relativePath) {
    return (0, node_fs_1.readFileSync)(node_path_1.default.join(process.cwd(), relativePath), 'utf8');
}
async function main() {
    await run('stable bootstrap keys do not change when the same callback params are re-read', () => {
        const paymentReturn = (0, payment_return_js_1.extractBillingReturnState)(new URLSearchParams({
            reference: 'DCAU-123',
            success: 'true',
        }));
        const firstKey = (0, subscription_page_state_js_1.buildSubscriptionBootstrapKey)('user-1', paymentReturn);
        const secondKey = (0, subscription_page_state_js_1.buildSubscriptionBootstrapKey)('user-1', paymentReturn);
        strict_1.default.equal(firstKey, 'user-1:DCAU-123|DCAU-123|||1|0|1');
        strict_1.default.equal(secondKey, firstKey);
    });
    await run('bootstrap keys change only when the callback state actually changes', () => {
        const successReturn = (0, payment_return_js_1.extractBillingReturnState)(new URLSearchParams({
            reference: 'DCAU-123',
            success: 'true',
        }));
        const canceledReturn = (0, payment_return_js_1.extractBillingReturnState)(new URLSearchParams({
            reference: 'DCAU-123',
            cancelled: 'true',
        }));
        strict_1.default.notEqual((0, subscription_page_state_js_1.buildSubscriptionBootstrapKey)('user-1', successReturn), (0, subscription_page_state_js_1.buildSubscriptionBootstrapKey)('user-1', canceledReturn));
        strict_1.default.equal((0, subscription_page_state_js_1.buildSubscriptionBootstrapKey)('', successReturn), null);
    });
    await run('meaningful usage data detection ignores empty payloads but accepts saved limits and usage rows', () => {
        strict_1.default.equal((0, subscription_page_state_js_1.hasMeaningfulSubscriptionUsageData)({
            plan: null,
            limits: {},
            limitRules: {},
            usageByLimit: {},
        }), false);
        strict_1.default.equal((0, subscription_page_state_js_1.hasMeaningfulSubscriptionUsageData)({
            plan: 'pro',
            limits: { max_uploads_total: 25 },
            limitRules: {},
            usageByLimit: {},
        }), true);
        strict_1.default.equal((0, subscription_page_state_js_1.hasMeaningfulSubscriptionUsageData)({
            plan: 'pro',
            limits: {},
            limitRules: {},
            usageByLimit: {
                max_tokens_total: { used: '1200' },
            },
        }), true);
    });
    await run('subscription page no longer mounts its own billing realtime refresh loop', () => {
        const source = readProjectFile('src/app/dashboard/settings/subscription/page.tsx');
        strict_1.default.equal(source.includes("channel(`billing-status:${user.id}`)"), false);
        strict_1.default.equal(source.includes('buildSubscriptionBootstrapKey'), true);
        strict_1.default.equal(source.includes('refreshUsageSection'), true);
    });
    await run('usage rows normalize numeric strings, fall back to saved limits, and preserve unlimited rules', () => {
        const result = (0, subscription_page_state_js_1.buildSubscriptionUsageRows)({
            snapshot: { managedPlan: 'pro' },
            currentPlanManagedPlan: 'pro',
            tier: 'pro',
            usage: {
                plan: 'pro',
                limits: {
                    max_uploads_total: 25,
                },
                limitRules: {
                    max_uploads_total: {
                        label: 'Uploads',
                        presentation: {
                            label: 'Saved uploads',
                            reset_description: 'Resets every month',
                        },
                    },
                    max_tokens_total: {
                        label: 'Tokens',
                        is_unlimited: true,
                    },
                },
                usageByLimit: {
                    max_uploads_total: {
                        used: '9',
                    },
                    max_tokens_total: {
                        used: '1450',
                        limit: null,
                        reset: {
                            label: 'Unlimited',
                        },
                    },
                },
            },
        });
        strict_1.default.equal(result.planCode, 'pro');
        strict_1.default.equal(result.hasData, true);
        strict_1.default.deepEqual(result.resetSummary, ['Resets every month', 'Unlimited']);
        const uploadsRow = result.rows.find((row) => row.key === 'max_uploads_total');
        strict_1.default.deepEqual(uploadsRow, {
            key: 'max_uploads_total',
            label: 'Saved uploads',
            used: 9,
            limit: 25,
            resetText: 'Resets every month',
        });
        const unlimitedRow = result.rows.find((row) => row.key === 'max_tokens_total');
        strict_1.default.deepEqual(unlimitedRow, {
            key: 'max_tokens_total',
            label: 'Tokens',
            used: 1450,
            limit: null,
            resetText: 'Unlimited',
        });
    });
    if (failed > 0) {
        process.exit(1);
    }
}
void main();
