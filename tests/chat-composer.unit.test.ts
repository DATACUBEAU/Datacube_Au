import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CHAT_COMPOSER_DESKTOP_MAX_HEIGHT_PX,
  CHAT_COMPOSER_MIN_HEIGHT_PX,
  CHAT_COMPOSER_MOBILE_VIEWPORT_RATIO,
  getChatComposerMaxHeight,
} from '../src/components/chat/chat-composer-sizing.js';

let failed = 0;

const repoRoot = process.cwd();

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error: unknown) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.stack : error);
  }
}

run('composer height constants match the accepted one-line and maximum bounds', () => {
  assert.equal(CHAT_COMPOSER_MIN_HEIGHT_PX, 48);
  assert.equal(CHAT_COMPOSER_DESKTOP_MAX_HEIGHT_PX, 220);
  assert.equal(CHAT_COMPOSER_MOBILE_VIEWPORT_RATIO, 0.4);
});

run('desktop max height remains bounded at 220px', () => {
  assert.equal(getChatComposerMaxHeight(900, false), 220);
  assert.equal(getChatComposerMaxHeight(768, false), 220);
});

run('mobile max height follows visible viewport without dropping below the one-line minimum', () => {
  assert.equal(getChatComposerMaxHeight(844, true), 220);
  assert.equal(getChatComposerMaxHeight(360, true), 144);
  assert.equal(getChatComposerMaxHeight(80, true), 48);
});

run('autosize implementation uses real scrollHeight and switches to internal scrolling at max height', () => {
  const source = readRepoFile('src/components/chat/chat-composer.tsx');

  assert.match(source, /textarea\.style\.height = 'auto'/);
  assert.match(source, /textarea\.scrollHeight/);
  assert.match(source, /textarea\.style\.overflowY = scrollHeight > maxHeight \? 'auto' : 'hidden'/);
  assert.match(source, /window\.visualViewport\?\.height/);
  assert.match(source, /window\.visualViewport\?\.addEventListener\('resize', scheduleResize\)/);
  assert.match(source, /window\.visualViewport\?\.addEventListener\('scroll', scheduleResize\)/);
  assert.match(source, /document\.fonts\?\.ready\.then\(scheduleResize\)/);
  assert.match(source, /window\.requestAnimationFrame/);
});

run('textarea starts as one line, wraps safely, and avoids horizontal overflow', () => {
  const source = readRepoFile('src/components/chat/chat-composer.tsx');

  assert.match(source, /rows=\{1\}/);
  assert.match(source, /min-h-12/);
  assert.match(source, /overflow-x-hidden/);
  assert.match(source, /\[overflow-wrap:anywhere\]/);
  assert.match(source, /onChange=\{\(event\) => \{/);
  assert.match(source, /resizeNow\(\);/);
});

run('keyboard handling preserves enter send, shift enter newline, IME, repeat, and empty prevention', () => {
  const source = readRepoFile('src/components/chat/chat-composer.tsx');

  assert.match(source, /event\.key !== 'Enter'/);
  assert.match(source, /event\.shiftKey/);
  assert.match(source, /event\.repeat/);
  assert.match(source, /nativeEvent\.isComposing/);
  assert.match(source, /isComposingRef\.current/);
  assert.match(source, /event\.currentTarget\.form\?\.requestSubmit\(\)/);
  assert.match(source, /value\.trim\(\)\.length > 0/);
});

run('send button is bottom aligned, touch sized, accessible, and remains available for stop generation', () => {
  const source = readRepoFile('src/components/chat/chat-composer.tsx');

  assert.match(source, /mb-0\.5 h-10 w-10 shrink-0 self-end rounded-full/);
  assert.match(source, /aria-label=\{isResponding \? stopButtonLabel : sendButtonLabel\}/);
  assert.match(source, /disabled=\{isResponding \? false : !canSubmit\}/);
  assert.match(source, /onStop\?\.\(\)/);
  assert.match(source, /focus-visible:ring-2/);
});

run('composer layout is constrained to chat width and includes mobile safe area spacing', () => {
  const source = readRepoFile('src/components/chat/chat-composer.tsx');

  assert.match(source, /shrink-0 border-t/);
  assert.match(source, /pb-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(source, /mx-auto w-full max-w-4xl/);
  assert.match(source, /rounded-\[1\.75rem\]/);
  assert.equal(source.includes('fixed'), false);
});

run('AU Chat and Global Chat both use the shared composer instead of duplicated fixed-height inputs', () => {
  const auSource = readRepoFile('src/app/dashboard/chat/page.tsx');
  const globalSource = readRepoFile('src/app/dashboard/global-chat/page.tsx');

  assert.match(auSource, /import \{ ChatComposer \} from '@\/components\/chat\/chat-composer'/);
  assert.match(globalSource, /import \{ ChatComposer \} from '@\/components\/chat\/chat-composer'/);
  assert.match(auSource, /<ChatComposer/);
  assert.match(globalSource, /<ChatComposer/);
  assert.equal(auSource.includes('rounded-full border bg-secondary p-3 pl-12 pr-4 text-base shadow-none focus-visible:ring-0 no-scrollbar h-12'), false);
  assert.equal(globalSource.includes('rounded-full border bg-secondary p-3 px-4 text-base shadow-none focus-visible:ring-0 no-scrollbar h-12'), false);
});

run('chat pages preserve streaming stop, disabled send protections, and status messaging', () => {
  const auSource = readRepoFile('src/app/dashboard/chat/page.tsx');
  const globalSource = readRepoFile('src/app/dashboard/global-chat/page.tsx');

  assert.match(auSource, /onStop=\{stopGeneration\}/);
  assert.match(globalSource, /onStop=\{stopGeneration\}/);
  assert.match(auSource, /sendDisabled=\{!input\.trim\(\) \|\| !selectedDocId \|\| !canChat/);
  assert.match(globalSource, /sendDisabled=\{!input\.trim\(\) \|\| !canChat\}/);
  assert.match(auSource, /Document is \{selectedDoc\.status\}/);
  assert.match(globalSource, /Reconnecting\.\.\./);
});

if (failed > 0) process.exit(1);
