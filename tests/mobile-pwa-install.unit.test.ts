import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const layout = read('src/app/dashboard/dashboard-client-layout.tsx');
assert.doesNotMatch(layout, /<HeaderPwaInstallButton/);
assert.doesNotMatch(read('src/app/dashboard/settings/page.tsx'), /<PwaInstallButton/);
const guide = read('src/components/site-manual-guide.tsx');
assert.match(guide, /href="\/download"/);
assert.doesNotMatch(guide, /beforeinstallprompt|Add to Home Screen/i);
const features = read('src/app/features/page.tsx');
assert.match(features, /Native Android app/);
assert.doesNotMatch(features, /Installable App \(PWA\)/);
assert.match(read('src/app/manifest.ts'), /display: "browser"/);
assert.doesNotMatch(read('src/app/layout.tsx'), /appleWebApp:/);
console.log('PASS Native Android download replaces web-install promotions');
