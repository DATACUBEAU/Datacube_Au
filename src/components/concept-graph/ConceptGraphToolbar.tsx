'use client';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useConceptGraphStore } from '@/hooks/use-concept-graph-store';
import { cn } from '@/lib/utils';
import { Focus, Layers, Sparkles, Target, Trash2 } from 'lucide-react';

export type GraphToolMode = 'select' | 'add_node' | 'add_edge';

export function ConceptGraphToolbar({
  docId,
  toolMode,
  onToolModeChange,
  onFitView,
  onCenterSelection,
}: {
  docId: string;
  toolMode: GraphToolMode;
  onToolModeChange: (mode: GraphToolMode) => void;
  onFitView: () => void;
  onCenterSelection: () => void;
}) {
  const doc = useConceptGraphStore(s => s.docs[docId]);
  const setOverlayMode = useConceptGraphStore(s => s.setOverlayMode);
  const deleteSelected = useConceptGraphStore(s => s.deleteSelected);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold text-muted-foreground">Tools</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Button
            type="button"
            size="sm"
            variant={toolMode === 'select' ? 'default' : 'secondary'}
            onClick={() => onToolModeChange('select')}
          >
            Select
          </Button>
          <Button
            type="button"
            size="sm"
            variant={toolMode === 'add_node' ? 'default' : 'secondary'}
            onClick={() => onToolModeChange('add_node')}
          >
            Node
          </Button>
          <Button
            type="button"
            size="sm"
            variant={toolMode === 'add_edge' ? 'default' : 'secondary'}
            onClick={() => onToolModeChange('add_edge')}
          >
            Edge
          </Button>
        </div>
      </div>

      <Separator />

      <div>
        <div className="text-xs font-semibold text-muted-foreground">View</div>
        <div className="mt-2 grid gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onFitView} className="justify-start gap-2">
            <Focus className="h-4 w-4" />
            Fit to view
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onCenterSelection} className="justify-start gap-2">
            <Target className="h-4 w-4" />
            Center selection
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => deleteSelected(docId)}
            className="justify-start gap-2"
            disabled={!doc || (doc.selectedNodeIds?.length ?? 0) === 0}
          >
            <Trash2 className="h-4 w-4" />
            Delete selected
          </Button>
        </div>
      </div>

      <Separator />

      <div>
        <div className="text-xs font-semibold text-muted-foreground">Highlights</div>
        <div className="mt-2">
          <div className={cn('grid w-full grid-cols-1 gap-2')}>
            <Button
              type="button"
              size="sm"
              variant={doc?.overlayMode === 'most_tested' ? 'default' : 'secondary'}
              onClick={() => setOverlayMode(docId, 'most_tested')}
              className="justify-start gap-2"
            >
              <Sparkles className="h-4 w-4" />
              Most tested
            </Button>
            <Button
              type="button"
              size="sm"
              variant={doc?.overlayMode === 'weak_areas' ? 'default' : 'secondary'}
              onClick={() => setOverlayMode(docId, 'weak_areas')}
              className="justify-start gap-2"
            >
              <Layers className="h-4 w-4" />
              Weak areas
            </Button>
            <Button
              type="button"
              size="sm"
              variant={doc?.overlayMode === 'prediction_focus' ? 'default' : 'secondary'}
              onClick={() => setOverlayMode(docId, 'prediction_focus')}
              className="justify-start gap-2"
            >
              <Target className="h-4 w-4" />
              Prediction focus
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOverlayMode(docId, 'none')}
            className="mt-2 w-full justify-start"
          >
            Clear highlights
          </Button>
        </div>
      </div>
    </div>
  );
}
