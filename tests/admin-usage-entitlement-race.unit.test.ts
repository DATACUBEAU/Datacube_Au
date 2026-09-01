import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/app/api/admin/limits/user-usage/route.ts', 'utf8');

// The authoritative server route must compare the effective plan as well as each
// metric's adjustability before submitting a correction prepared from an older snapshot.
assert.match(
  route,
  /function sameAdjustmentEligibility[\s\S]+left\.plan !== right\.plan[\s\S]+leftRule\.mode === rightRule\.mode[\s\S]+leftRule\.isEnabled === rightRule\.isEnabled/,
);

// A reset-all operation is especially sensitive to plan/rule churn: compare all
// approved metrics so neither a newly enabled nor newly disabled usage metric can
// slip through a stale batch assembled from the first snapshot.
assert.match(
  route,
  /if \(!sameAdjustmentEligibility\(initialEffective, mutationEffective, APPROVED_LIMIT_KEYS\)\)[\s\S]+usage_adjustment_conflict/,
);

// Single-metric corrections must apply the same plan/eligibility guard to the
// selected metric and retain the existing exact reset-window comparison.
assert.match(
  route,
  /sameAdjustmentEligibility\(initialEffective, mutationEffective, \[body\.metricKey\]\)[\s\S]+sameResetWindow\(initialReset, mutationEffective\.usage\.by_limit\[body\.metricKey\]\.reset\)/,
);

// The stale-entitlement guard must execute before either mutation RPC is called.
const resetAllGuardIndex = route.indexOf('sameAdjustmentEligibility(initialEffective, mutationEffective, APPROVED_LIMIT_KEYS)');
const batchRpcIndex = route.indexOf("rpc('admin_adjust_usage_batch_versioned'");
assert.ok(resetAllGuardIndex >= 0 && batchRpcIndex > resetAllGuardIndex);

const singleGuardIndex = route.indexOf('sameAdjustmentEligibility(initialEffective, mutationEffective, [body.metricKey])');
const singleRpcIndex = route.indexOf("rpc('admin_adjust_usage_versioned'");
assert.ok(singleGuardIndex >= 0 && singleRpcIndex > singleGuardIndex);

assert.match(route, /code: 'usage_changed'/);
assert.match(route, /Refresh and try again/);

console.log('admin usage entitlement-race regressions passed');
