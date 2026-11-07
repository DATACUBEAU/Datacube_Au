import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readProjectFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const tabs = readProjectFile('src/app/dashboard/settings/_components/plan-usage-tabs.tsx');
const subscriptionLayout = readProjectFile('src/app/dashboard/settings/subscription/layout.tsx');
const usageLayout = readProjectFile('src/app/dashboard/settings/usage/layout.tsx');

assert.equal(tabs.includes("usePathname"), true, 'tab active state should follow the current route');
assert.equal(tabs.includes('aria-label="Plan and usage settings"'), true, 'tab group should have a semantic navigation label');
assert.equal(tabs.includes("aria-current={active ? 'page' : undefined}"), true, 'active tab should be exposed to assistive technology');
assert.equal(tabs.includes("href: '/dashboard/settings/subscription'"), true, 'plan and billing tab should be present');
assert.equal(tabs.includes("href: '/dashboard/settings/usage'"), true, 'usage tab should be present');
assert.equal(tabs.includes("pathname.startsWith(`${tab.href}/`)"), true, 'nested settings routes should retain their active tab');

assert.equal(subscriptionLayout.includes('PlanUsageTabs'), true, 'subscription route should render the shared tabs');
assert.equal(usageLayout.includes('PlanUsageTabs'), true, 'usage route should render the shared tabs');
assert.equal(subscriptionLayout.includes('<PlanUsageTabs />'), true);
assert.equal(usageLayout.includes('<PlanUsageTabs />'), true);

console.log('PASS plan and usage settings navigation remains available across sibling routes');
