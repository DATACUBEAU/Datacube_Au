import { createHash } from 'node:crypto';

export type FeatureFlagEtagRow = {
  key: string;
  enabled: boolean;
  category: string;
  description: string;
  scope: string;
  config: Record<string, unknown>;
  updated_at: string;
};

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
}

function normalizeEtagForComparison(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('W/') ? trimmed.slice(2).trim() : trimmed;
}

export function buildFeatureFlagsEtag(rows: FeatureFlagEtagRow[]): string {
  const stableRows = rows
    .map((row) => ({
      key: row.key,
      enabled: row.enabled,
      category: row.category,
      description: row.description,
      scope: row.scope,
      config: row.config,
      updated_at: row.updated_at,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const hash = createHash('sha256').update(stableJson(stableRows)).digest('base64url');
  return `"feature-flags:${hash}"`;
}

export function ifNoneMatchIncludesEtag(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const normalizedEtag = normalizeEtagForComparison(etag);
  return ifNoneMatch
    .split(',')
    .map((entry) => entry.trim())
    .some((entry) => entry === '*' || normalizeEtagForComparison(entry) === normalizedEtag);
}
