import type { GenerateKnowledgeOutput } from '@/app/actions';
import type { ConceptEdge, ConceptGraph, ConceptNode } from '@/lib/concept-graph/types';
import { normalizeLabel, stableId } from '@/lib/concept-graph/utils';

function parseQuotedConcepts(content: string): Array<{ term: string; details?: string }> {
  const results: Array<{ term: string; details?: string }> = [];
  const regex = /'([^']+)'\s*\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const term = match[1]?.trim();
    const details = match[2]?.trim();
    if (term) results.push({ term, details });
  }
  return results;
}

function parseRelationshipPairs(text: string): Array<{ a: string; b: string; relationship: ConceptEdge['relationship'] }> {
  const pairs: Array<{ a: string; b: string; relationship: ConceptEdge['relationship'] }> = [];
  const quoted = [...text.matchAll(/'([^']+)'/g)].map(m => m[1]?.trim()).filter(Boolean) as string[];
  if (quoted.length >= 2) {
    for (let i = 0; i < quoted.length - 1; i += 1) {
      pairs.push({ a: quoted[i], b: quoted[i + 1], relationship: 'commonly_tested_with' });
    }
  }
  const depends = text.match(/'([^']+)'[^.\n]{0,120}(depends on|requires|builds on)[^.\n]{0,120}'([^']+)'/i);
  if (depends?.[1] && depends?.[3]) {
    pairs.push({ a: depends[1].trim(), b: depends[3].trim(), relationship: 'depends_on' });
  }
  const leads = text.match(/'([^']+)'[^.\n]{0,120}(leads to|results in|enables)[^.\n]{0,120}'([^']+)'/i);
  if (leads?.[1] && leads?.[3]) {
    pairs.push({ a: leads[1].trim(), b: leads[3].trim(), relationship: 'leads_to' });
  }
  return pairs;
}

export function buildConceptGraphFromKnowledge(docId: string, knowledge: GenerateKnowledgeOutput): ConceptGraph {
  const nodes: Record<string, ConceptNode> = {};
  const edges: ConceptEdge[] = [];
  const nodeStats: ConceptGraph['nodeStats'] = {};

  const concepts = parseQuotedConcepts(knowledge.conceptMap || '');
  for (const c of concepts) {
    const label = c.term.trim();
    const id = stableId('c', `${docId}:${normalizeLabel(label)}`);
    nodes[id] = {
      id,
      label,
      masteryLevel: 50,
      relatedConcepts: [],
      source: 'textbook',
    };
    nodeStats[id] = {
      examRelevance: 30,
      practiceAttempts: 0,
      practiceCorrect: 0,
    };
  }

  const relationshipText = `${knowledge.topicRelationships || ''}\n${knowledge.conceptMap || ''}`;
  const pairs = parseRelationshipPairs(relationshipText);
  const byLabel = new Map<string, string>();
  for (const id of Object.keys(nodes)) {
    byLabel.set(normalizeLabel(nodes[id].label), id);
  }

  const edgeSet = new Set<string>();
  for (const p of pairs) {
    const aId = byLabel.get(normalizeLabel(p.a));
    const bId = byLabel.get(normalizeLabel(p.b));
    if (!aId || !bId || aId === bId) continue;
    const key = `${aId}:${p.relationship}:${bId}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push({ id: stableId('e', key), from: aId, to: bId, relationship: p.relationship });
    nodes[aId].relatedConcepts = Array.from(new Set([...nodes[aId].relatedConcepts, bId]));
    nodes[bId].relatedConcepts = Array.from(new Set([...nodes[bId].relatedConcepts, aId]));
  }

  return {
    nodes,
    edges,
    nodeStats,
    notesByNodeId: {},
    tagsByNodeId: {},
  };
}

