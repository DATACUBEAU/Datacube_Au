export type TarEntryLike = {
  path?: string;
  type?: string;
  linkpath?: string;
};

const SAFE_ENTRY_TYPES = new Set(['File', 'OldFile', 'ContiguousFile', 'Directory']);

function normalizeRelativeArchivePath(rawPath: string, label: string): string {
  if (!rawPath || rawPath.includes('\0')) {
    throw new Error(`Unsafe FastEmbed model archive ${label}: empty or NUL-containing path`);
  }

  const slashed = rawPath.replace(/\\/g, '/');
  if (slashed.startsWith('/') || slashed.startsWith('//') || /^[A-Za-z]:\//.test(slashed)) {
    throw new Error(`Unsafe FastEmbed model archive ${label}: absolute path ${rawPath}`);
  }

  const segments = slashed.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`Unsafe FastEmbed model archive ${label}: traversal path ${rawPath}`);
  }

  const normalized = segments.join('/');
  if (!normalized) {
    throw new Error(`Unsafe FastEmbed model archive ${label}: empty normalized path`);
  }
  return normalized;
}

export function assertSafeModelArchiveEntry(model: string, entry: TarEntryLike): void {
  const modelRoot = normalizeRelativeArchivePath(model, 'model root');
  const entryPath = normalizeRelativeArchivePath(String(entry.path || ''), 'entry');

  if (entryPath !== modelRoot && !entryPath.startsWith(`${modelRoot}/`)) {
    throw new Error(`Unsafe FastEmbed model archive entry outside expected model root: ${entryPath}`);
  }

  const entryType = String(entry.type || '');
  if (!SAFE_ENTRY_TYPES.has(entryType)) {
    throw new Error(`Unsafe FastEmbed model archive entry type ${entryType || '<missing>'}: ${entryPath}`);
  }

  if (entry.linkpath) {
    throw new Error(`Unsafe FastEmbed model archive link target on ${entryPath}`);
  }
}
