import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let failed = 0;

type AsyncTest = () => void | Promise<void>;

async function run(name: string, fn: AsyncTest) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error: any) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

function readProjectFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

async function main() {
  await run('shared document select value keeps truncation classes centralized for compact filename headers', () => {
    const componentSource = readProjectFile('src/components/document-select-value.tsx');

    assert.equal(componentSource.includes('FileNameText'), true);
    assert.equal(componentSource.includes('truncate'), true);
    assert.equal(componentSource.includes('min-w-0'), true);
    assert.equal(componentSource.includes('max-w-full'), true);
  });

  await run('chat, upload, knowledge, practice, and predictions use the shared truncation renderer', () => {
    const files = [
      'src/app/dashboard/chat/page.tsx',
      'src/components/upload/upload-center.tsx',
      'src/app/dashboard/knowledge/page.tsx',
      'src/app/dashboard/practice/page.tsx',
      'src/app/dashboard/predictions/page.tsx',
    ];

    for (const file of files) {
      const source = readProjectFile(file);
      assert.equal(source.includes("DocumentSelectValue"), true, `expected ${file} to use DocumentSelectValue`);
    }
  });

  await run('document rows still enforce overflow-hidden containers around filename text', () => {
    const documentsPage = readProjectFile('src/app/dashboard/documents/page.tsx');
    const uploadCenter = readProjectFile('src/components/upload/upload-center.tsx');
    const chatPage = readProjectFile('src/app/dashboard/chat/page.tsx');

    assert.equal(documentsPage.includes('flex min-w-0 items-center gap-2 overflow-hidden'), true);
    assert.equal(uploadCenter.includes('flex min-w-0 items-center gap-2 overflow-hidden'), true);
    assert.equal(chatPage.includes('Chatting with:'), true);
    assert.equal(chatPage.includes('max-w-full'), true);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
