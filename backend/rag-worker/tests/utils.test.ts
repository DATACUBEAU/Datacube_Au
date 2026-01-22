import { deterministicChunking, computeHash } from '../src/utils';

describe('RAG Utilities', () => {
  test('deterministicChunking creates expected chunks', () => {
    const text = 'This is a test document for chunking. It should be split into multiple pieces.';
    const chunks = deterministicChunking(text, 20, 5);
    
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toBe('This is a test docum');
    // Verify overlap and continuity if needed
  });

  test('computeHash is consistent', () => {
    const text = 'consistent text';
    const hash1 = computeHash(text);
    const hash2 = computeHash(text);
    expect(hash1).toBe(hash2);
    expect(hash1).toBe('9f688536109318a4783f9872580c8502');
  });
});
