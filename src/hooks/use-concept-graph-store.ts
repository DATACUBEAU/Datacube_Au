'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { GenerateKnowledgeOutput, GeneratePredictionsOutput, PracticeQuestion } from '@/app/actions';
import type { ConceptEdge, ConceptGraph, ConceptNode, ConceptNodeStats } from '@/lib/concept-graph/types';
import { buildConceptGraphFromKnowledge } from '@/lib/concept-graph/knowledge-to-graph';
import { clampInt, normalizeLabel, stableId } from '@/lib/concept-graph/utils';

type OverlayMode = 'none' | 'most_tested' | 'weak_areas' | 'prediction_focus';

type GraphDocState = {
  graph: ConceptGraph;
  positionsByNodeId: Record<string, { x: number; y: number }>;
  expandedNodeIds: Record<string, true>;
  pinnedNodeIds: Record<string, true>;
  selectedNodeIds: string[];
  hoveredNodeId: string | null;
  overlayMode: OverlayMode;
  lastCenteredNodeId: string | null;
};

type ConceptGraphStoreState = {
  activeDocId: string | null;
  docs: Record<string, GraphDocState>;
  setActiveDoc: (docId: string) => void;
  ensureDoc: (docId: string) => void;
  importFromKnowledge: (docId: string, knowledge: GenerateKnowledgeOutput) => void;
  applyPredictions: (docId: string, predictions: GeneratePredictionsOutput) => void;
  applyPracticeAnswer: (docId: string, question: PracticeQuestion, isCorrect: boolean) => void;
  upsertNode: (docId: string, node: ConceptNode) => void;
  upsertEdge: (docId: string, edge: Omit<ConceptEdge, 'id'> & { id?: string }) => void;
  deleteSelected: (docId: string) => void;
  setSelectedNodeIds: (docId: string, ids: string[]) => void;
  setHoveredNodeId: (docId: string, id: string | null) => void;
  toggleExpanded: (docId: string, nodeId: string) => void;
  togglePinned: (docId: string, nodeId: string) => void;
  setOverlayMode: (docId: string, mode: OverlayMode) => void;
  setLastCenteredNodeId: (docId: string, nodeId: string | null) => void;
  setNodeLabel: (docId: string, nodeId: string, label: string) => void;
  setNodeNotes: (docId: string, nodeId: string, notes: string) => void;
  setNodeTags: (docId: string, nodeId: string, tags: string[]) => void;
  setNodePosition: (docId: string, nodeId: string, pos: { x: number; y: number }) => void;
  setManyNodePositions: (docId: string, positions: Record<string, { x: number; y: number }>) => void;
  getActiveDocState: () => GraphDocState | null;
};

function defaultGraph(): ConceptGraph {
  return { nodes: {}, edges: [], nodeStats: {}, notesByNodeId: {}, tagsByNodeId: {} };
}

function defaultDocState(): GraphDocState {
  return {
    graph: defaultGraph(),
    positionsByNodeId: {},
    expandedNodeIds: {},
    pinnedNodeIds: {},
    selectedNodeIds: [],
    hoveredNodeId: null,
    overlayMode: 'none',
    lastCenteredNodeId: null,
  };
}

function mergeGraphs(base: ConceptGraph, incoming: ConceptGraph): ConceptGraph {
  const mergedNodes: Record<string, ConceptNode> = { ...base.nodes };
  const mergedStats: Record<string, ConceptNodeStats> = { ...base.nodeStats };
  const mergedNotes: Record<string, string> = { ...base.notesByNodeId };
  const mergedTags: Record<string, string[]> = { ...base.tagsByNodeId };

  for (const [id, node] of Object.entries(incoming.nodes)) {
    const existing = mergedNodes[id];
    mergedNodes[id] = existing
      ? {
          ...existing,
          label: existing.label || node.label,
          source: existing.source || node.source,
          masteryLevel: clampInt(existing.masteryLevel ?? node.masteryLevel, 0, 100),
          relatedConcepts: Array.from(new Set([...(existing.relatedConcepts || []), ...(node.relatedConcepts || [])])),
        }
      : node;
  }

  for (const [id, stats] of Object.entries(incoming.nodeStats)) {
    const existing = mergedStats[id];
    mergedStats[id] = {
      examRelevance: clampInt((existing?.examRelevance ?? 0) || stats.examRelevance, 0, 100),
      predictionLikelihood: existing?.predictionLikelihood ?? stats.predictionLikelihood,
      practiceAttempts: (existing?.practiceAttempts ?? 0) + (stats.practiceAttempts ?? 0),
      practiceCorrect: (existing?.practiceCorrect ?? 0) + (stats.practiceCorrect ?? 0),
      lastPracticedAt: Math.max(existing?.lastPracticedAt ?? 0, stats.lastPracticedAt ?? 0) || existing?.lastPracticedAt || stats.lastPracticedAt,
      lastPredictedAt: Math.max(existing?.lastPredictedAt ?? 0, stats.lastPredictedAt ?? 0) || existing?.lastPredictedAt || stats.lastPredictedAt,
    };
  }

  for (const [id, notes] of Object.entries(incoming.notesByNodeId)) {
    mergedNotes[id] = notes;
  }
  for (const [id, tags] of Object.entries(incoming.tagsByNodeId)) {
    mergedTags[id] = tags;
  }

  const edgeKey = (e: ConceptEdge) => `${e.from}:${e.relationship}:${e.to}`;
  const existingEdgeKeys = new Set(base.edges.map(edgeKey));
  const mergedEdges = [...base.edges];
  for (const e of incoming.edges) {
    const key = edgeKey(e);
    if (existingEdgeKeys.has(key)) continue;
    existingEdgeKeys.add(key);
    mergedEdges.push(e);
  }

  return {
    nodes: mergedNodes,
    edges: mergedEdges,
    nodeStats: mergedStats,
    notesByNodeId: mergedNotes,
    tagsByNodeId: mergedTags,
  };
}

function scoreExamRelevance(stats: ConceptNodeStats): number {
  const pred = clampInt(stats.predictionLikelihood ?? 0, 0, 100);
  const practice = clampInt(stats.practiceAttempts * 8, 0, 100);
  const base = clampInt(stats.examRelevance ?? 0, 0, 100);
  return clampInt(base * 0.4 + pred * 0.4 + practice * 0.2, 0, 100);
}

function matchConceptIdsByText(graph: ConceptGraph, text: string): string[] {
  const hay = normalizeLabel(text);
  const hits: Array<{ id: string; score: number }> = [];
  for (const node of Object.values(graph.nodes)) {
    const needle = normalizeLabel(node.label);
    if (!needle) continue;
    if (hay.includes(needle)) {
      hits.push({ id: node.id, score: needle.length });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 4).map(h => h.id);
}

export const useConceptGraphStore = create<ConceptGraphStoreState>()(
  persist(
    (set, get) => ({
      activeDocId: null,
      docs: {},

      setActiveDoc: (docId) => {
        set(state => {
          if (!state.docs[docId]) {
            return { activeDocId: docId, docs: { ...state.docs, [docId]: defaultDocState() } };
          }
          return { activeDocId: docId };
        });
      },

      ensureDoc: (docId) => {
        set(state => (state.docs[docId] ? state : { docs: { ...state.docs, [docId]: defaultDocState() } }));
      },

      importFromKnowledge: (docId, knowledge) => {
        const incoming = buildConceptGraphFromKnowledge(docId, knowledge);
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          const merged = mergeGraphs(doc.graph, incoming);
          const initialExpanded: Record<string, true> = { ...doc.expandedNodeIds };
          const nodeIds = Object.keys(merged.nodes);
          const seed = nodeIds.slice(0, Math.min(12, nodeIds.length));
          for (const id of seed) initialExpanded[id] = true;
          return {
            docs: {
              ...state.docs,
              [docId]: { ...doc, graph: merged, expandedNodeIds: initialExpanded },
            },
          };
        });
      },

      applyPredictions: (docId, predictions) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          const graph = doc.graph;
          const nodes = { ...graph.nodes };
          const nodeStats = { ...graph.nodeStats };
          const edges = [...graph.edges];
          const byNorm = new Map<string, string>();
          for (const n of Object.values(nodes)) byNorm.set(normalizeLabel(n.label), n.id);

          const now = Date.now();
          for (const p of predictions.predictions) {
            const label = p.topic.trim();
            const norm = normalizeLabel(label);
            let id = byNorm.get(norm);
            if (!id) {
              id = stableId('c', `${docId}:${norm}`);
              nodes[id] = { id, label, masteryLevel: 50, relatedConcepts: [], source: 'prediction' };
              byNorm.set(norm, id);
            }
            const existing = nodeStats[id] ?? { examRelevance: 30, practiceAttempts: 0, practiceCorrect: 0 };
            const mergedStats: ConceptNodeStats = {
              ...existing,
              predictionLikelihood: clampInt(p.likelihood, 0, 100),
              lastPredictedAt: now,
            };
            mergedStats.examRelevance = scoreExamRelevance(mergedStats);
            nodeStats[id] = mergedStats;

            const related = matchConceptIdsByText({ ...graph, nodes }, `${p.topic}\n${p.rationale}\n${p.examTip}`)
              .filter(rid => rid !== id)
              .slice(0, 2);

            for (const rid of related) {
              const key = `${rid}:commonly_tested_with:${id}`;
              const edgeId = stableId('e', key);
              if (!edges.some(e => e.id === edgeId)) {
                edges.push({ id: edgeId, from: rid, to: id, relationship: 'commonly_tested_with' });
              }
              nodes[id].relatedConcepts = Array.from(new Set([...nodes[id].relatedConcepts, rid]));
              nodes[rid].relatedConcepts = Array.from(new Set([...nodes[rid].relatedConcepts, id]));
            }
          }

          return {
            docs: {
              ...state.docs,
              [docId]: {
                ...doc,
                graph: {
                  ...graph,
                  nodes,
                  edges,
                  nodeStats,
                },
              },
            },
          };
        });
      },

      applyPracticeAnswer: (docId, question, isCorrect) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          const graph = doc.graph;
          const nodeStats = { ...graph.nodeStats };
          const nodes = { ...graph.nodes };
          const matched = matchConceptIdsByText(graph, `${question.questionText}\n${question.explanation}`);
          const now = Date.now();
          for (const id of matched) {
            const stats = nodeStats[id] ?? { examRelevance: 30, practiceAttempts: 0, practiceCorrect: 0 };
            const practiceAttempts = (stats.practiceAttempts ?? 0) + 1;
            const practiceCorrect = (stats.practiceCorrect ?? 0) + (isCorrect ? 1 : 0);
            const accuracy = practiceAttempts > 0 ? practiceCorrect / practiceAttempts : 0;
            const masteryLevel = clampInt(30 + accuracy * 70, 0, 100);
            nodes[id] = { ...nodes[id], masteryLevel };
            const next: ConceptNodeStats = {
              ...stats,
              practiceAttempts,
              practiceCorrect,
              lastPracticedAt: now,
            };
            next.examRelevance = scoreExamRelevance(next);
            nodeStats[id] = next;
          }

          return {
            docs: {
              ...state.docs,
              [docId]: {
                ...doc,
                graph: { ...graph, nodes, nodeStats },
              },
            },
          };
        });
      },

      upsertNode: (docId, node) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          const existingStats = doc.graph.nodeStats[node.id] ?? { examRelevance: 30, practiceAttempts: 0, practiceCorrect: 0 };
          return {
            docs: {
              ...state.docs,
              [docId]: {
                ...doc,
                graph: {
                  ...doc.graph,
                  nodes: { ...doc.graph.nodes, [node.id]: node },
                  nodeStats: { ...doc.graph.nodeStats, [node.id]: existingStats },
                },
              },
            },
          };
        });
      },

      upsertEdge: (docId, edge) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          const id = edge.id ?? stableId('e', `${edge.from}:${edge.relationship}:${edge.to}`);
          const nextEdge: ConceptEdge = { id, from: edge.from, to: edge.to, relationship: edge.relationship };
          const edges = doc.graph.edges.some(e => e.id === id)
            ? doc.graph.edges.map(e => (e.id === id ? nextEdge : e))
            : [...doc.graph.edges, nextEdge];
          const nodes = { ...doc.graph.nodes };
          if (nodes[nextEdge.from]) {
            nodes[nextEdge.from] = {
              ...nodes[nextEdge.from],
              relatedConcepts: Array.from(new Set([...(nodes[nextEdge.from].relatedConcepts || []), nextEdge.to])),
            };
          }
          if (nodes[nextEdge.to]) {
            nodes[nextEdge.to] = {
              ...nodes[nextEdge.to],
              relatedConcepts: Array.from(new Set([...(nodes[nextEdge.to].relatedConcepts || []), nextEdge.from])),
            };
          }
          return {
            docs: {
              ...state.docs,
              [docId]: {
                ...doc,
                graph: { ...doc.graph, edges, nodes },
              },
            },
          };
        });
      },

      deleteSelected: (docId) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          const selected = new Set(doc.selectedNodeIds);
          if (selected.size === 0) return state;
          const nodes: Record<string, ConceptNode> = {};
          for (const [id, node] of Object.entries(doc.graph.nodes)) {
            if (!selected.has(id)) nodes[id] = node;
          }
          const edges = doc.graph.edges.filter(e => !selected.has(e.from) && !selected.has(e.to));
          const nodeStats: Record<string, ConceptNodeStats> = {};
          for (const [id, stats] of Object.entries(doc.graph.nodeStats)) {
            if (!selected.has(id)) nodeStats[id] = stats;
          }
          const notesByNodeId: Record<string, string> = {};
          for (const [id, notes] of Object.entries(doc.graph.notesByNodeId)) {
            if (!selected.has(id)) notesByNodeId[id] = notes;
          }
          const tagsByNodeId: Record<string, string[]> = {};
          for (const [id, tags] of Object.entries(doc.graph.tagsByNodeId)) {
            if (!selected.has(id)) tagsByNodeId[id] = tags;
          }
          return {
            docs: {
              ...state.docs,
              [docId]: {
                ...doc,
                selectedNodeIds: [],
                graph: { nodes, edges, nodeStats, notesByNodeId, tagsByNodeId },
              },
            },
          };
        });
      },

      setSelectedNodeIds: (docId, ids) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          return { docs: { ...state.docs, [docId]: { ...doc, selectedNodeIds: ids } } };
        });
      },

      setHoveredNodeId: (docId, id) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          return { docs: { ...state.docs, [docId]: { ...doc, hoveredNodeId: id } } };
        });
      },

      toggleExpanded: (docId, nodeId) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          const expanded = { ...doc.expandedNodeIds };
          if (expanded[nodeId]) {
            delete expanded[nodeId];
          } else {
            expanded[nodeId] = true;
          }
          return { docs: { ...state.docs, [docId]: { ...doc, expandedNodeIds: expanded } } };
        });
      },

      togglePinned: (docId, nodeId) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          const pinned = { ...doc.pinnedNodeIds };
          if (pinned[nodeId]) {
            delete pinned[nodeId];
          } else {
            pinned[nodeId] = true;
          }
          return { docs: { ...state.docs, [docId]: { ...doc, pinnedNodeIds: pinned } } };
        });
      },

      setOverlayMode: (docId, mode) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          return { docs: { ...state.docs, [docId]: { ...doc, overlayMode: mode } } };
        });
      },

      setLastCenteredNodeId: (docId, nodeId) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          return { docs: { ...state.docs, [docId]: { ...doc, lastCenteredNodeId: nodeId } } };
        });
      },

      setNodeLabel: (docId, nodeId, label) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          const node = doc.graph.nodes[nodeId];
          if (!node) return state;
          const next = { ...node, label };
          return {
            docs: {
              ...state.docs,
              [docId]: { ...doc, graph: { ...doc.graph, nodes: { ...doc.graph.nodes, [nodeId]: next } } },
            },
          };
        });
      },

      setNodeNotes: (docId, nodeId, notes) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          return {
            docs: {
              ...state.docs,
              [docId]: { ...doc, graph: { ...doc.graph, notesByNodeId: { ...doc.graph.notesByNodeId, [nodeId]: notes } } },
            },
          };
        });
      },

      setNodeTags: (docId, nodeId, tags) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          return {
            docs: {
              ...state.docs,
              [docId]: { ...doc, graph: { ...doc.graph, tagsByNodeId: { ...doc.graph.tagsByNodeId, [nodeId]: tags } } },
            },
          };
        });
      },

      setNodePosition: (docId, nodeId, pos) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          return {
            docs: {
              ...state.docs,
              [docId]: { ...doc, positionsByNodeId: { ...doc.positionsByNodeId, [nodeId]: { x: pos.x, y: pos.y } } },
            },
          };
        });
      },

      setManyNodePositions: (docId, positions) => {
        set(state => {
          const doc = state.docs[docId] ?? defaultDocState();
          return {
            docs: {
              ...state.docs,
              [docId]: { ...doc, positionsByNodeId: { ...doc.positionsByNodeId, ...positions } },
            },
          };
        });
      },

      getActiveDocState: () => {
        const { activeDocId, docs } = get();
        if (!activeDocId) return null;
        return docs[activeDocId] ?? null;
      },
    }),
    {
      name: 'concept_graph_store_v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ activeDocId: state.activeDocId, docs: state.docs }),
    }
  )
);
