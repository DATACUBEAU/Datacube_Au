"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildUserCacheKey = buildUserCacheKey;
exports.readUserCache = readUserCache;
exports.readUserCacheSync = readUserCacheSync;
exports.writeUserCache = writeUserCache;
exports.clearUserCache = clearUserCache;
const CACHE_PREFIX = 'dcau:cache:v1';
const LOCAL_FALLBACK_PREFIX = `${CACHE_PREFIX}:ls:`;
const DB_NAME = 'dcau_offline_cache';
const DB_VERSION = 1;
const STORE_NAME = 'resources';
const USER_INDEX = 'user_id';
function normalizeRoute(route) {
    const trimmed = route.trim();
    if (!trimmed)
        return '/';
    const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}
function stableStringify(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'string')
        return value;
    if (typeof value !== 'object')
        return String(value);
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    const serialized = entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join('|');
    return `{${serialized}}`;
}
function hashString(input) {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
        hash = (hash << 5) - hash + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}
function queryToKey(query) {
    const serialized = stableStringify(query);
    if (!serialized)
        return 'no-query';
    return hashString(serialized);
}
function fallbackStorageKey(key) {
    return `${LOCAL_FALLBACK_PREFIX}${key}`;
}
function buildUserCacheKey(input) {
    const route = normalizeRoute(input.route);
    const queryKey = queryToKey(input.query);
    const schemaVersion = Number.isFinite(input.schemaVersion) ? Number(input.schemaVersion) : 1;
    const key = [
        CACHE_PREFIX,
        input.userId,
        route,
        input.source.trim() || 'unknown',
        input.endpoint.trim() || 'unknown',
        `q:${queryKey}`,
        `s:${schemaVersion}`,
    ].join(':');
    return { key, queryKey, schemaVersion, route };
}
function canUseIndexedDb() {
    return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}
function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            const store = db.objectStoreNames.contains(STORE_NAME)
                ? request.transaction?.objectStore(STORE_NAME) ?? null
                : db.createObjectStore(STORE_NAME, { keyPath: 'key' });
            if (store && !store.indexNames.contains(USER_INDEX)) {
                store.createIndex(USER_INDEX, 'user_id', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
async function idbGet(key) {
    const db = await openDb();
    try {
        const value = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
        return value;
    }
    finally {
        db.close();
    }
}
async function idbSet(record) {
    const db = await openDb();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }
    finally {
        db.close();
    }
}
async function idbDeleteByUser(userId) {
    const db = await openDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const index = store.index(USER_INDEX);
            const cursorRequest = index.openCursor(IDBKeyRange.only(userId));
            let removed = 0;
            cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (!cursor)
                    return;
                cursor.delete();
                removed += 1;
                cursor.continue();
            };
            tx.oncomplete = () => resolve(removed);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    }
    finally {
        db.close();
    }
}
function localGet(key) {
    if (typeof window === 'undefined')
        return null;
    try {
        const raw = localStorage.getItem(fallbackStorageKey(key));
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function localSet(record) {
    if (typeof window === 'undefined')
        return;
    try {
        localStorage.setItem(fallbackStorageKey(record.key), JSON.stringify(record));
    }
    catch {
        // Ignore localStorage quota errors.
    }
}
function localDeleteByUser(userId) {
    if (typeof window === 'undefined')
        return 0;
    let removed = 0;
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(LOCAL_FALLBACK_PREFIX))
            continue;
        if (key.includes(`:${userId}:`)) {
            keysToRemove.push(key);
        }
    }
    for (const key of keysToRemove) {
        localStorage.removeItem(key);
        removed += 1;
    }
    return removed;
}
function isRecordValid(record, opts) {
    if (!record)
        return false;
    if (record.user_id !== opts.userId)
        return false;
    if (record.schema_version !== opts.schemaVersion)
        return false;
    const now = Date.now();
    if (typeof record.ttl_ms === 'number' && record.ttl_ms > 0 && now - record.cached_at > record.ttl_ms) {
        return false;
    }
    if (typeof opts.maxAgeMs === 'number' && opts.maxAgeMs > 0 && now - record.cached_at > opts.maxAgeMs) {
        return false;
    }
    return true;
}
async function readUserCache(opts) {
    const { key, schemaVersion } = buildUserCacheKey({
        userId: opts.userId,
        route: opts.route,
        source: opts.source,
        endpoint: opts.endpoint,
        query: opts.query,
        schemaVersion: opts.schemaVersion,
    });
    const validation = {
        userId: opts.userId,
        schemaVersion,
        maxAgeMs: opts.maxAgeMs,
    };
    if (canUseIndexedDb()) {
        try {
            const record = await idbGet(key);
            if (isRecordValid(record, validation)) {
                return { data: record.data, cachedAt: record.cached_at };
            }
        }
        catch {
            // Fallback to localStorage below.
        }
    }
    const local = localGet(key);
    if (isRecordValid(local, validation)) {
        return { data: local.data, cachedAt: local.cached_at };
    }
    return { data: null, cachedAt: null };
}
function readUserCacheSync(opts) {
    const { key, schemaVersion } = buildUserCacheKey({
        userId: opts.userId,
        route: opts.route,
        source: opts.source,
        endpoint: opts.endpoint,
        query: opts.query,
        schemaVersion: opts.schemaVersion,
    });
    const validation = {
        userId: opts.userId,
        schemaVersion,
        maxAgeMs: opts.maxAgeMs,
    };
    const local = localGet(key);
    if (isRecordValid(local, validation)) {
        return { data: local.data, cachedAt: local.cached_at };
    }
    return { data: null, cachedAt: null };
}
async function writeUserCache(opts) {
    const { key, queryKey, schemaVersion, route } = buildUserCacheKey({
        userId: opts.userId,
        route: opts.route,
        source: opts.source,
        endpoint: opts.endpoint,
        query: opts.query,
        schemaVersion: opts.schemaVersion,
    });
    const record = {
        key,
        user_id: opts.userId,
        route,
        query_key: queryKey,
        source: opts.source,
        endpoint: opts.endpoint,
        schema_version: schemaVersion,
        cached_at: Date.now(),
        ttl_ms: typeof opts.ttlMs === 'number' ? opts.ttlMs : null,
        data: opts.data,
    };
    if (canUseIndexedDb()) {
        try {
            await idbSet(record);
            if (opts.mirrorToLocalStorage) {
                localSet(record);
            }
            return;
        }
        catch {
            // Fallback to localStorage below.
        }
    }
    localSet(record);
}
async function clearUserCache(userId) {
    let removed = 0;
    if (canUseIndexedDb()) {
        try {
            removed += await idbDeleteByUser(userId);
        }
        catch {
            // Ignore and continue with fallback cleanup.
        }
    }
    removed += localDeleteByUser(userId);
    return removed;
}
