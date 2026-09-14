import { assertSafeModelArchiveEntry } from '../src/archive-safety';

describe('FastEmbed archive entry safety', () => {
  const model = 'sentence-transformers-all-MiniLM-L6-v2';

  it('accepts ordinary files and directories inside the expected model root', () => {
    expect(() => assertSafeModelArchiveEntry(model, { path: `${model}/`, type: 'Directory' })).not.toThrow();
    expect(() => assertSafeModelArchiveEntry(model, { path: `./${model}/onnx/model.onnx`, type: 'File' })).not.toThrow();
    expect(() => assertSafeModelArchiveEntry(model, { path: `${model}/config.json`, type: 'OldFile' })).not.toThrow();
  });

  it.each([
    '../escape.txt',
    `${model}/../escape.txt`,
    '/tmp/escape.txt',
    'C:\\temp\\escape.txt',
    '\\server\\share\\escape.txt',
    'other-model/config.json',
  ])('rejects path escape %s', (entryPath) => {
    expect(() => assertSafeModelArchiveEntry(model, { path: entryPath, type: 'File' })).toThrow(/Unsafe FastEmbed model archive/);
  });

  it.each(['SymbolicLink', 'Link', 'CharacterDevice', 'BlockDevice', 'FIFO'])('rejects unsafe entry type %s', (type) => {
    expect(() => assertSafeModelArchiveEntry(model, { path: `${model}/unsafe`, type })).toThrow(/entry type/);
  });

  it('rejects link targets even if the entry is mislabeled as a file', () => {
    expect(() => assertSafeModelArchiveEntry(model, {
      path: `${model}/config.json`,
      type: 'File',
      linkpath: '../../escape',
    })).toThrow(/link target/);
  });
});
