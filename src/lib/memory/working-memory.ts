import { getWorkingMemoryStore } from '@/lib/memory/kv-store';

export type WorkingMemoryScope = 'global' | 'doc';

export type WorkingMemoryTurn = {
  id: string;
  ts: number;
  role: 'user' | 'assistant';
  text: string;
  tags?: string[];
  tokenEstimate?: number;
};

export type WorkingMemoryPayload = {
  turns: WorkingMemoryTurn[];
  summary: string;
  pinnedFacts: string[];
  lastUpdatedAt: number;
  expiresAt?: number;
  serverUpdatedAt?: number;
  turnsSinceServerSync?: number;
};

export type DocMemoryMeta = {
  lastUsedAt: number;
  sizeBytes: number;
};

export type MemoryWriteResult = {
  sizeBytes: number;
  pruned: boolean;
  payload: WorkingMemoryPayload;
};

const PREFIX = 'dcau';

const DOC_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const DOC_SOFT_LIMIT_BYTES = 8 * 1024 * 1024;
const DOC_HARD_LIMIT_BYTES = 10 * 1024 * 1024;
const DEFAULT_KEEP_TURNS = 40;
const GLOBAL_SOFT_LIMIT_BYTES = 1 * 1024 * 1024;
const GLOBAL_HARD_LIMIT_BYTES = 2 * 1024 * 1024;
const GLOBAL_KEEP_TURNS = 80;

export function globalMemoryKey(userId: string) {
  return `${PREFIX}:mem:global:${userId}`;
}

export function docMemoryKey(userId: string, docId: string) {
  return `${PREFIX}:mem:doc:${userId}:${docId}`;
}

export function docMetaKey(userId: string, docId: string) {
  return `${PREFIX}:meta:doc:${userId}:${docId}`;
}

export function utf8ByteSize(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return Buffer.byteLength(text, 'utf8');
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizePayload(input: Partial<WorkingMemoryPayload> | null): WorkingMemoryPayload {
  const now = Date.now();
  return {
    turns: Array.isArray(input?.turns) ? input!.turns : [],
    summary: typeof input?.summary === 'string' ? input.summary : '',
    pinnedFacts: Array.isArray(input?.pinnedFacts) ? (input!.pinnedFacts as any[]).filter(v => typeof v === 'string') : [],
    lastUpdatedAt: typeof input?.lastUpdatedAt === 'number' ? input.lastUpdatedAt : now,
    expiresAt: typeof input?.expiresAt === 'number' ? input.expiresAt : undefined,
    serverUpdatedAt: typeof input?.serverUpdatedAt === 'number' ? input.serverUpdatedAt : undefined,
    turnsSinceServerSync: typeof input?.turnsSinceServerSync === 'number' ? input.turnsSinceServerSync : undefined,
  };
}

function serializePayload(payload: WorkingMemoryPayload): { json: string; sizeBytes: number } {
  const json = JSON.stringify(payload);
  return { json, sizeBytes: utf8ByteSize(json) };
}

function inferScopeFromKey(key: string): WorkingMemoryScope | null {
  if (key.startsWith(`${PREFIX}:mem:global:`)) return 'global';
  if (key.startsWith(`${PREFIX}:mem:doc:`)) return 'doc';
  return null;
}

function pruneTurnsToLimit(payload: WorkingMemoryPayload, maxTurns: number): WorkingMemoryPayload {
  if (payload.turns.length <= maxTurns) return payload;
  return { ...payload, turns: payload.turns.slice(-maxTurns) };
}

function pruneToHardLimit(
  payload: WorkingMemoryPayload,
  hardLimitBytes: number,
  keepTurns: number
): { payload: WorkingMemoryPayload; pruned: boolean; sizeBytes: number } {
  let current = pruneTurnsToLimit(payload, keepTurns);
  let { sizeBytes } = serializePayload(current);
  let pruned = current.turns.length !== payload.turns.length;

  while (sizeBytes > hardLimitBytes && current.turns.length > 0) {
    current = { ...current, turns: current.turns.slice(1) };
    sizeBytes = serializePayload(current).sizeBytes;
    pruned = true;
  }

  if (sizeBytes > hardLimitBytes) {
    const minimal: WorkingMemoryPayload = {
      turns: [],
      summary: current.summary,
      pinnedFacts: current.pinnedFacts,
      lastUpdatedAt: current.lastUpdatedAt,
      expiresAt: current.expiresAt,
    };
    sizeBytes = serializePayload(minimal).sizeBytes;
    return { payload: minimal, pruned: true, sizeBytes };
  }

  return { payload: current, pruned, sizeBytes };
}

export async function loadWorkingMemory(key: string): Promise<WorkingMemoryPayload | null> {
  if (!key) return null;
  const store = getWorkingMemoryStore();
  const raw = await store.getItem(key);
  const parsed = safeJsonParse<WorkingMemoryPayload>(raw);
  return parsed ? normalizePayload(parsed) : null;
}

export async function saveWorkingMemory(
  key: string,
  payload: WorkingMemoryPayload,
  opts?: {
    scope?: WorkingMemoryScope;
    softLimitBytes?: number;
    hardLimitBytes?: number;
    keepTurns?: number;
    ttlMs?: number;
    userId?: string;
    docId?: string;
  }
): Promise<MemoryWriteResult> {
  const store = getWorkingMemoryStore();
  const now = Date.now();
  const scope: WorkingMemoryScope = opts?.scope ?? inferScopeFromKey(key) ?? 'doc';

  let next = normalizePayload(payload);
  next.lastUpdatedAt = now;

  if (scope === 'doc') {
    const ttl = opts?.ttlMs ?? DOC_TTL_MS;
    next.expiresAt = now + ttl;
  }

  const softLimitBytes =
    opts?.softLimitBytes ?? (scope === 'doc' ? DOC_SOFT_LIMIT_BYTES : GLOBAL_SOFT_LIMIT_BYTES);
  const hardLimitBytes =
    opts?.hardLimitBytes ?? (scope === 'doc' ? DOC_HARD_LIMIT_BYTES : GLOBAL_HARD_LIMIT_BYTES);
  const keepTurns = opts?.keepTurns ?? (scope === 'doc' ? DEFAULT_KEEP_TURNS : GLOBAL_KEEP_TURNS);

  let pruned = false;
  let encoded = serializePayload(next);

  if (encoded.sizeBytes > softLimitBytes) {
    const result = pruneToHardLimit(next, hardLimitBytes, keepTurns);
    next = result.payload;
    pruned = result.pruned;
    encoded = { json: JSON.stringify(next), sizeBytes: result.sizeBytes };
  }

  await store.setItem(key, encoded.json);

  if (scope === 'doc' && opts?.userId && opts?.docId) {
    const meta: DocMemoryMeta = { lastUsedAt: now, sizeBytes: encoded.sizeBytes };
    await store.setItem(docMetaKey(opts.userId, opts.docId), JSON.stringify(meta));
  }

  return { sizeBytes: encoded.sizeBytes, pruned, payload: next };
}

export async function appendTurn(
  key: string,
  turn: WorkingMemoryTurn,
  opts?: Parameters<typeof saveWorkingMemory>[2]
): Promise<MemoryWriteResult> {
  const existing = await loadWorkingMemory(key);
  const payload = normalizePayload(existing);
  payload.turns = [...payload.turns, turn];
  payload.turnsSinceServerSync = (payload.turnsSinceServerSync ?? 0) + 1;
  return saveWorkingMemory(key, payload, opts);
}

export async function clearWorkingMemory(key: string): Promise<void> {
  const store = getWorkingMemoryStore();
  await store.removeItem(key);
}

export async function clearDocWorkingMemory(userId: string, docId: string): Promise<void> {
  const store = getWorkingMemoryStore();
  await store.removeItem(docMemoryKey(userId, docId));
  await store.removeItem(docMetaKey(userId, docId));
}

export async function clearAllLocalWorkingMemory(): Promise<{ removed: number }> {
  const store = getWorkingMemoryStore();
  const keys = await store.keys();
  const toRemove = keys.filter(k => k.startsWith(`${PREFIX}:mem:`) || k.startsWith(`${PREFIX}:meta:doc:`));
  await Promise.all(toRemove.map(k => store.removeItem(k)));
  return { removed: toRemove.length };
}

export async function getDocMemorySizeBytes(userId: string, docId: string): Promise<number> {
  const store = getWorkingMemoryStore();
  const meta = safeJsonParse<DocMemoryMeta>(await store.getItem(docMetaKey(userId, docId)));
  if (meta && typeof meta.sizeBytes === 'number') return meta.sizeBytes;
  const payload = await loadWorkingMemory(docMemoryKey(userId, docId));
  if (!payload) return 0;
  return serializePayload(payload).sizeBytes;
}

export async function sweepExpiredDocWorkingMemory(): Promise<{ removedKeys: string[] }> {
  const store = getWorkingMemoryStore();
  const keys = await store.keys();
  const now = Date.now();
  const removedKeys: string[] = [];

  const docKeys = keys.filter(k => k.startsWith(`${PREFIX}:mem:doc:`));
  for (const key of docKeys) {
    const payload = await loadWorkingMemory(key);
    if (!payload) continue;
    const expiresAt = typeof payload.expiresAt === 'number' ? payload.expiresAt : payload.lastUpdatedAt + DOC_TTL_MS;
    if (expiresAt < now) {
      await store.removeItem(key);
      removedKeys.push(key);
    }
  }

  const metaKeys = keys.filter(k => k.startsWith(`${PREFIX}:meta:doc:`));
  for (const key of metaKeys) {
    const docKeyGuess = key.replace(`${PREFIX}:meta:doc:`, `${PREFIX}:mem:doc:`);
    if (removedKeys.includes(docKeyGuess)) {
      await store.removeItem(key);
      removedKeys.push(key);
    }
  }

  return { removedKeys };
}
