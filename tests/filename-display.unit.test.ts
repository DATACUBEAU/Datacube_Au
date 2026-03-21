import assert from 'node:assert/strict';
import { splitFileName } from '../src/lib/ui/filename-display.js';

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

async function main() {
  await run('splitFileName preserves the final extension for long file names', () => {
    const result = splitFileName('demo2_p_examdemo2_p_examdemo2_p_exam.txt');
    assert.equal(result.stem, 'demo2_p_examdemo2_p_examdemo2_p_exam');
    assert.equal(result.extension, '.txt');
  });

  await run('splitFileName keeps compound file stems intact', () => {
    const result = splitFileName('archive.backup.final.pdf');
    assert.equal(result.stem, 'archive.backup.final');
    assert.equal(result.extension, '.pdf');
  });

  await run('splitFileName does not treat dotfiles as having extensions', () => {
    const result = splitFileName('.env');
    assert.equal(result.stem, '.env');
    assert.equal(result.extension, null);
  });

  await run('splitFileName ignores trailing dots', () => {
    const result = splitFileName('notes.');
    assert.equal(result.stem, 'notes.');
    assert.equal(result.extension, null);
  });

  if (failed > 0) {
    process.exit(1);
  }
}

void main();
