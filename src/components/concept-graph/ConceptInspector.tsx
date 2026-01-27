'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useConceptGraphStore } from '@/hooks/use-concept-graph-store';
import { ExternalLink, Tag, Wand2 } from 'lucide-react';
import Link from 'next/link';

export function ConceptInspector({ docId }: { docId: string }) {
  const doc = useConceptGraphStore(s => s.docs[docId]);
  const setNodeLabel = useConceptGraphStore(s => s.setNodeLabel);
  const setNodeNotes = useConceptGraphStore(s => s.setNodeNotes);
  const setNodeTags = useConceptGraphStore(s => s.setNodeTags);
  const toggleExpanded = useConceptGraphStore(s => s.toggleExpanded);
  const togglePinned = useConceptGraphStore(s => s.togglePinned);
  const setSelectedNodeIds = useConceptGraphStore(s => s.setSelectedNodeIds);

  const nodeId = doc?.selectedNodeIds?.[0] || null;
  const node = nodeId ? doc?.graph.nodes[nodeId] : null;
  const stats = nodeId ? doc?.graph.nodeStats[nodeId] : null;
  const notes = nodeId ? doc?.graph.notesByNodeId[nodeId] : '';
  const tags = nodeId ? doc?.graph.tagsByNodeId[nodeId] || [] : [];

  const [tagText, setTagText] = useState('');

  const related = useMemo(() => {
    if (!node || !doc) return [];
    return node.relatedConcepts
      .map(id => doc.graph.nodes[id])
      .filter(Boolean)
      .slice(0, 12);
  }, [doc, node]);

  if (!doc) {
    return (
      <div className="h-full rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Select a document to view the concept graph.
      </div>
    );
  }

  if (!nodeId || !node) {
    return (
      <div className="h-full rounded-xl border bg-card p-4">
        <div className="text-sm font-semibold">Inspector</div>
        <div className="mt-2 text-sm text-muted-foreground">Select a node to see details.</div>
        <Separator className="my-4" />
        <div className="text-xs text-muted-foreground">Tip: Use box select or shift-click to multi-select.</div>
      </div>
    );
  }

  return (
    <div className="h-full rounded-xl border bg-card">
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Selected concept</div>
            <div className="mt-2">
              <Input
                value={node.label}
                onChange={e => setNodeLabel(docId, nodeId, e.target.value)}
                className="h-9"
                aria-label="Concept label"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">Mastery {Math.round(node.masteryLevel)}</Badge>
              <Badge variant="outline" className="text-[10px]">Relevance {Math.round(stats?.examRelevance ?? 0)}</Badge>
              <Badge variant="outline" className={cn('text-[10px]', node.source === 'prediction' ? 'border-primary/40' : '')}>
                {node.source}
              </Badge>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => toggleExpanded(docId, nodeId)}
            className="gap-2"
          >
            <Wand2 className="h-4 w-4" />
            Expand / collapse
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => togglePinned(docId, nodeId)}
          >
            Pin
          </Button>
        </div>

        <Separator className="my-4" />

        <div className="text-sm font-semibold">Notes</div>
        <div className="mt-2">
          <Textarea
            value={notes}
            onChange={e => setNodeNotes(docId, nodeId, e.target.value)}
            className="min-h-[110px]"
          />
        </div>

        <Separator className="my-4" />

        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Tags</div>
          <Tag className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {tags.length === 0 ? (
            <span className="text-sm text-muted-foreground">No tags yet.</span>
          ) : (
            tags.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setNodeTags(docId, nodeId, tags.filter(x => x !== t))}
                className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted"
              >
                {t}
              </button>
            ))
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            value={tagText}
            onChange={e => setTagText(e.target.value)}
            placeholder="Add tag"
            className="h-9"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const v = tagText.trim();
              if (!v) return;
              setNodeTags(docId, nodeId, Array.from(new Set([...tags, v])));
              setTagText('');
            }}
          >
            Add
          </Button>
        </div>

        <Separator className="my-4" />

        <div className="text-sm font-semibold">Related concepts</div>
      </div>

      <ScrollArea className="h-[260px] px-4 pb-4">
        <div className="space-y-2">
          {related.length === 0 ? (
            <div className="text-sm text-muted-foreground">No related concepts yet.</div>
          ) : (
            related.map(rc => (
              <button
                key={rc.id}
                type="button"
                onClick={() => setSelectedNodeIds(docId, [rc.id])}
                className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted"
              >
                <div className="truncate font-medium">{rc.label}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Mastery {Math.round(rc.masteryLevel)}</span>
                  <span>•</span>
                  <span>Source {rc.source}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      <div className="border-t p-4">
        <div className="flex flex-col gap-2">
          <Button asChild className="w-full justify-between" variant="secondary">
            <Link href="/dashboard/predictions">
              Run predictions
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild className="w-full justify-between" variant="outline">
            <Link href="/dashboard/practice">
              Start practice
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

