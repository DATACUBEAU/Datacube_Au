import assert from 'node:assert/strict';
import {
  buildFollowUpSuggestions,
  formatAssistantResponseText,
  normalizeAssistantCitations,
  parseAssistantResponseBlocks,
} from '../src/lib/chat/assistant-response.js';

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
  await run('response formatting removes bold markers and duplicate source lines', () => {
    const formatted = formatAssistantResponseText(`
Key takeaway

The key ideas are:

*   **Matter** has mass and occupies space.
*   **Properties** can be physical or chemical.

SOURCE

demo_note.txtdemo_note.txtdemo_note.txtdemo_note.txt
`);

    assert.equal(formatted.includes('**'), false);
    assert.equal(formatted.includes('SOURCE'), false);
    assert.equal(formatted.includes('demo_note.txtdemo_note.txt'), false);
    assert.match(formatted, /Matter has mass and occupies space\./);
  });

  await run('response parsing keeps headings and lists readable', () => {
    const blocks = parseAssistantResponseBlocks(`
Key takeaway

- Matter has mass and occupies space.
- Temperature affects particle motion.
`);

    assert.deepEqual(blocks, [
      { type: 'heading', content: 'Key takeaway' },
      {
        type: 'ul',
        items: [
          'Matter has mass and occupies space.',
          'Temperature affects particle motion.',
        ],
      },
    ]);
  });

  await run('citation normalization removes duplicates across strings and objects', () => {
    const citations = normalizeAssistantCitations([
      'demo_note.txt',
      { fileName: 'demo_note.txt' },
      { title: 'chapter_1.pdf' },
      { filename: 'chapter_1.pdf' },
    ]);

    assert.deepEqual(citations, ['demo_note.txt', 'chapter_1.pdf']);
  });

  await run('follow-up suggestions stay relevant and unique', () => {
    const prompts = buildFollowUpSuggestions({
      answer: 'Matter is anything that has mass and occupies space.',
      userQuestion: 'what is matter',
      documentName: 'demo_note.txt',
    });

    assert.equal(prompts.length, 3);
    assert.equal(new Set(prompts).size, prompts.length);
    assert.equal(prompts.some((prompt) => /matter/i.test(prompt)), true);
  });

  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
