'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type OnNodesChange,
  type OnEdgesChange,
  type NodeMouseHandler,
  type OnConnect,
  useReactFlow,
} from 'reactflow';
import { nanoid } from 'nanoid';
import { useConceptGraphStore } from '@/hooks/use-concept-graph-store';
import type { ConceptEdge, ConceptNode } from '@/lib/concept-graph/types';
import { computeRadialPositions } from '@/components/concept-graph/concept-graph-layout';
import { ConceptGraphNode, type ConceptGraphNodeData } from '@/components/concept-graph/ConceptGraphNode';
import type { GraphToolMode } from '@/components/concept-graph/ConceptGraphToolbar';

type Point = { x: number; y: number };

const nodeTypes = {
  concept: ConceptGraphNode,
};

function toFlowEdges(edges: ConceptEdge[], visible: Set<string>, highlighted: Set<string>): Edge[] {
  return edges
    .filter(e => visible.has(e.from) && visible.has(e.to))
    .map(e => ({
      id: e.id,
      source: e.from,
      target: e.to,
      animated: highlighted.has(e.id),
      style: highlighted.has(e.id) ? { strokeWidth: 2 } : { strokeWidth: 1 },
      data: { relationship: e.relationship },
    }));
}

function rankOverlay(node: ConceptNode, stats: any, overlayMode: string): number {
  if (overlayMode === 'weak_areas') return 100 - (node.masteryLevel ?? 0);
  if (overlayMode === 'prediction_focus') return stats?.predictionLikelihood ?? 0;
  return stats?.examRelevance ?? 0;
}

function computeVisibleIds(options: {
  nodes: Record<string, ConceptNode>;
  edges: ConceptEdge[];
  expandedNodeIds: Record<string, true>;
  pinnedNodeIds: Record<string, true>;
  selectedNodeIds: string[];
  overlayMode: string;
  nodeStats: Record<string, any>;
}): Set<string> {
  const { nodes, edges, expandedNodeIds, pinnedNodeIds, selectedNodeIds, overlayMode, nodeStats } = options;
  const base = new Set<string>();
  for (const id of Object.keys(expandedNodeIds)) base.add(id);
  for (const id of Object.keys(pinnedNodeIds)) base.add(id);
  for (const id of selectedNodeIds) base.add(id);

  if (base.size === 0) {
    const ranked = Object.values(nodes)
      .map(n => ({ id: n.id, score: rankOverlay(n, nodeStats[n.id], overlayMode) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 14);
    for (const r of ranked) base.add(r.id);
  }

  const visible = new Set<string>(base);
  const adjacency = new Map<string, string[]>();
  for (const id of Object.keys(nodes)) adjacency.set(id, []);
  for (const e of edges) {
    adjacency.get(e.from)?.push(e.to);
    adjacency.get(e.to)?.push(e.from);
  }

  for (const id of [...base]) {
    const neighbors = adjacency.get(id) || [];
    for (const nb of neighbors) visible.add(nb);
  }

  const cap = 60;
  if (visible.size > cap) {
    const ranked = [...visible]
      .map(id => ({ id, score: rankOverlay(nodes[id], nodeStats[id], overlayMode) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, cap)
      .map(x => x.id);
    return new Set(ranked);
  }

  return visible;
}

function computeHighlightedEdges(selectedNodeIds: string[], edges: ConceptEdge[]): Set<string> {
  if (selectedNodeIds.length === 0) return new Set();
  const selected = new Set(selectedNodeIds);
  const highlighted = new Set<string>();
  for (const e of edges) {
    if (selected.has(e.from) || selected.has(e.to)) highlighted.add(e.id);
  }
  return highlighted;
}

export function ConceptGraphCanvas({
  docId,
  toolMode,
  onToolModeChange,
  onApiReady,
}: {
  docId: string;
  toolMode: GraphToolMode;
  onToolModeChange: (m: GraphToolMode) => void;
  onApiReady?: (api: { fitView: () => void; centerSelection: () => void }) => void;
}) {
  const doc = useConceptGraphStore(s => s.docs[docId]);
  const setSelectedNodeIds = useConceptGraphStore(s => s.setSelectedNodeIds);
  const setHoveredNodeId = useConceptGraphStore(s => s.setHoveredNodeId);
  const toggleExpanded = useConceptGraphStore(s => s.toggleExpanded);
  const togglePinned = useConceptGraphStore(s => s.togglePinned);
  const setNodePosition = useConceptGraphStore(s => s.setNodePosition);
  const setManyNodePositions = useConceptGraphStore(s => s.setManyNodePositions);
  const upsertNode = useConceptGraphStore(s => s.upsertNode);
  const upsertEdge = useConceptGraphStore(s => s.upsertEdge);
  const setLastCenteredNodeId = useConceptGraphStore(s => s.setLastCenteredNodeId);

  const rf = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const [localNodes, setLocalNodes] = useState<Node<ConceptGraphNodeData>[]>([]);
  const [localEdges, setLocalEdges] = useState<Edge[]>([]);

  const graph = doc?.graph;
  const overlayMode = doc?.overlayMode || 'none';

  const visibleIds = useMemo(() => {
    if (!graph || !doc) return new Set<string>();
    return computeVisibleIds({
      nodes: graph.nodes,
      edges: graph.edges,
      expandedNodeIds: doc.expandedNodeIds,
      pinnedNodeIds: doc.pinnedNodeIds,
      selectedNodeIds: doc.selectedNodeIds,
      overlayMode,
      nodeStats: graph.nodeStats,
    });
  }, [doc, graph, overlayMode]);

  const highlightedEdges = useMemo(() => (graph ? computeHighlightedEdges(doc?.selectedNodeIds || [], graph.edges) : new Set<string>()), [doc?.selectedNodeIds, graph]);

  const dimmedIds = useMemo(() => {
    if (!graph || overlayMode === 'none') return new Set<string>();
    const ranked = Object.values(graph.nodes)
      .filter(n => visibleIds.has(n.id))
      .map(n => ({ id: n.id, score: rankOverlay(n, graph.nodeStats[n.id], overlayMode) }))
      .sort((a, b) => b.score - a.score);
    const keep = new Set(ranked.slice(0, Math.min(14, ranked.length)).map(r => r.id));
    const dim = new Set<string>();
    for (const id of visibleIds) if (!keep.has(id)) dim.add(id);
    return dim;
  }, [graph, overlayMode, visibleIds]);

  useEffect(() => {
    if (!graph || !doc) {
      setLocalNodes([]);
      setLocalEdges([]);
      return;
    }

    const basePositions = doc.positionsByNodeId || {};
    const needed = computeRadialPositions({
      nodeIds: [...visibleIds],
      edges: graph.edges,
      centerId: doc.selectedNodeIds?.[0] || null,
      existing: basePositions,
    });
    if (Object.keys(needed).length > 0) setManyNodePositions(docId, needed);
    const nextPositions = { ...basePositions, ...needed };

    const nodes: Node<ConceptGraphNodeData>[] = [...visibleIds]
      .map(id => {
        const n = graph.nodes[id];
        const stats = graph.nodeStats[id];
        const pos = nextPositions[id] || { x: 0, y: 0 };
        return {
          id,
          type: 'concept',
          position: pos,
          data: {
            label: n.label,
            masteryLevel: n.masteryLevel,
            examRelevance: stats?.examRelevance ?? 0,
            overlayMode,
            isPinned: !!doc.pinnedNodeIds[id],
            isExpanded: !!doc.expandedNodeIds[id],
            isDimmed: dimmedIds.has(id),
            onTogglePinned: () => togglePinned(docId, id),
            onToggleExpanded: () => toggleExpanded(docId, id),
          },
          selected: doc.selectedNodeIds?.includes(id) ?? false,
        };
      })
      .sort((a, b) => (a.selected ? -1 : 0) - (b.selected ? -1 : 0));

    const edges = toFlowEdges(graph.edges, visibleIds, highlightedEdges);
    setLocalNodes(nodes);
    setLocalEdges(edges);
  }, [doc, docId, graph, overlayMode, visibleIds, highlightedEdges, dimmedIds, setManyNodePositions, toggleExpanded, togglePinned]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const alreadySelected = (doc?.selectedNodeIds?.length ?? 0) === 1 && doc?.selectedNodeIds?.[0] === node.id;
      setSelectedNodeIds(docId, [node.id]);
      if (toolMode === 'select' && alreadySelected) {
        toggleExpanded(docId, node.id);
      }
      setLastCenteredNodeId(docId, node.id);
    },
    [doc?.selectedNodeIds, docId, setLastCenteredNodeId, setSelectedNodeIds, toggleExpanded, toolMode]
  );

  const onNodeMouseEnter: NodeMouseHandler = useCallback(
    (_event, node) => {
      setHoveredNodeId(docId, node.id);
    },
    [docId, setHoveredNodeId]
  );

  const onNodeMouseLeave: NodeMouseHandler = useCallback(
    () => {
      setHoveredNodeId(docId, null);
    },
    [docId, setHoveredNodeId]
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (toolMode !== 'add_edge') return;
      if (!connection.source || !connection.target) return;
      upsertEdge(docId, { from: connection.source, to: connection.target, relationship: 'commonly_tested_with' });
    },
    [docId, toolMode, upsertEdge]
  );

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      for (const c of changes) {
        if (c.type === 'position' && 'id' in c && c.position) {
          setNodePosition(docId, c.id, c.position as Point);
        }
      }
      setLocalNodes(ns => applyNodeChanges(changes, ns));
    },
    [docId, setNodePosition]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      setLocalEdges(es => applyEdgeChanges(changes, es));
    },
    []
  );

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (toolMode !== 'add_node') return;
      if (!wrapperRef.current || !graph) return;
      const bounds = wrapperRef.current.getBoundingClientRect();
      const position = rf.project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      const id = `u_${nanoid(10)}`;
      const node: ConceptNode = { id, label: 'New concept', masteryLevel: 50, relatedConcepts: [], source: 'textbook' };
      upsertNode(docId, node);
      setNodePosition(docId, id, position);
      setSelectedNodeIds(docId, [id]);
      onToolModeChange('select');
    },
    [docId, graph, onToolModeChange, rf, setNodePosition, setSelectedNodeIds, toolMode, upsertNode]
  );

  const fitView = useCallback(() => {
    rf.fitView({ duration: 500, padding: 0.2 });
  }, [rf]);

  const centerSelection = useCallback(() => {
    const id = doc?.selectedNodeIds?.[0] || null;
    if (!id) {
      fitView();
      return;
    }
    const pos = doc?.positionsByNodeId?.[id];
    if (!pos) return;
    rf.setCenter(pos.x, pos.y, { duration: 500, zoom: 1 });
  }, [doc?.positionsByNodeId, doc?.selectedNodeIds, fitView, rf]);

  useEffect(() => {
    onApiReady?.({ fitView, centerSelection });
  }, [centerSelection, fitView, onApiReady]);

  useEffect(() => {
    if (!doc?.lastCenteredNodeId) return;
    const id = doc.lastCenteredNodeId;
    const pos = doc.positionsByNodeId?.[id];
    if (!pos) return;
    rf.setCenter(pos.x, pos.y, { duration: 450, zoom: 1.05 });
  }, [doc?.lastCenteredNodeId, doc?.positionsByNodeId, rf]);

  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
        No concept graph loaded yet.
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="h-full w-full overflow-hidden rounded-xl border bg-card">
      <ReactFlow
        nodes={localNodes}
        edges={localEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onPaneClick={onPaneClick}
        onSelectionChange={(sel) => {
          const ids = sel.nodes.map(n => n.id);
          setSelectedNodeIds(docId, ids);
        }}
        nodesConnectable={toolMode === 'add_edge'}
        nodesDraggable={toolMode !== 'add_edge'}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>

      <div className="pointer-events-none absolute left-4 top-4 flex gap-2">
        <button
          type="button"
          className="pointer-events-auto rounded-md border bg-background/70 px-3 py-1 text-xs hover:bg-background"
          onClick={fitView}
        >
          Fit
        </button>
        <button
          type="button"
          className="pointer-events-auto rounded-md border bg-background/70 px-3 py-1 text-xs hover:bg-background"
          onClick={centerSelection}
        >
          Center
        </button>
      </div>
    </div>
  );
}
