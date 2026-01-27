import type { ConceptEdge } from '@/lib/concept-graph/types';
import { stableId } from '@/lib/concept-graph/utils';

type Point = { x: number; y: number };

function seededAngle(seed: string): number {
  const id = stableId('a', seed);
  const raw = parseInt(id.split('_')[1] || '0', 16);
  const u = (raw % 100000) / 100000;
  return u * Math.PI * 2;
}

export function computeRadialPositions(options: {
  nodeIds: string[];
  edges: ConceptEdge[];
  centerId?: string | null;
  existing: Record<string, Point>;
}): Record<string, Point> {
  const { nodeIds, edges, centerId, existing } = options;
  const missing = nodeIds.filter(id => !existing[id]);
  if (missing.length === 0) return {};

  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const e of edges) {
    if (adjacency.has(e.from) && adjacency.has(e.to)) {
      adjacency.get(e.from)?.push(e.to);
      adjacency.get(e.to)?.push(e.from);
    }
  }

  const root = centerId && adjacency.has(centerId) ? centerId : nodeIds[0] || null;
  const dist = new Map<string, number>();
  const q: string[] = [];
  if (root) {
    dist.set(root, 0);
    q.push(root);
  }
  while (q.length) {
    const cur = q.shift() as string;
    const d = dist.get(cur) ?? 0;
    for (const nb of adjacency.get(cur) || []) {
      if (!dist.has(nb)) {
        dist.set(nb, d + 1);
        q.push(nb);
      }
    }
  }

  const levels = new Map<number, string[]>();
  for (const id of nodeIds) {
    const d = dist.get(id) ?? 2;
    const level = Math.min(4, d);
    const arr = levels.get(level) || [];
    arr.push(id);
    levels.set(level, arr);
  }

  const positions: Record<string, Point> = {};
  if (root && !existing[root]) positions[root] = { x: 0, y: 0 };

  for (const [level, ids] of [...levels.entries()].sort((a, b) => a[0] - b[0])) {
    const ring = level === 0 ? 0 : 260 + (level - 1) * 180;
    const base = seededAngle(`${root || 'root'}:${level}`);
    const step = ids.length > 0 ? (Math.PI * 2) / ids.length : Math.PI * 2;
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      if (existing[id] || positions[id]) continue;
      const a = base + step * i;
      const jitter = 25 * Math.sin(seededAngle(`${id}:j`));
      positions[id] = { x: Math.cos(a) * (ring + jitter), y: Math.sin(a) * (ring + jitter) };
    }
  }

  return positions;
}

