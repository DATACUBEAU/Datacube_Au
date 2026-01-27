'use client';

import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { motion } from 'framer-motion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Pin, PinOff, Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ConceptGraphNodeData = {
  label: string;
  masteryLevel: number;
  examRelevance: number;
  overlayMode: 'none' | 'most_tested' | 'weak_areas' | 'prediction_focus';
  isPinned: boolean;
  isExpanded: boolean;
  isDimmed: boolean;
  onTogglePinned: () => void;
  onToggleExpanded: () => void;
};

function masteryColor(masteryLevel: number): string {
  if (masteryLevel < 45) return 'border-rose-500/60 bg-rose-500/10';
  if (masteryLevel < 75) return 'border-amber-500/60 bg-amber-500/10';
  return 'border-emerald-500/60 bg-emerald-500/10';
}

function ConceptGraphNodeInner({ data, selected }: NodeProps<ConceptGraphNodeData>) {
  const pulse = useMemo(() => {
    const intensity = Math.max(0, Math.min(1, data.examRelevance / 100));
    const shouldPulse = data.overlayMode !== 'none' ? intensity > 0.4 : intensity > 0.7;
    return { intensity, shouldPulse };
  }, [data.examRelevance, data.overlayMode]);

  const dimClass = data.isDimmed ? 'opacity-40 saturate-50' : 'opacity-100';
  const selectedClass = selected ? 'ring-2 ring-primary/60 shadow-[0_0_0_2px_hsl(var(--primary)/0.15)]' : '';
  const base = masteryColor(data.masteryLevel);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.div
            layout
            animate={
              pulse.shouldPulse
                ? {
                    boxShadow: [
                      '0 0 0px rgba(110,168,255,0)',
                      `0 0 ${8 + Math.round(14 * pulse.intensity)}px rgba(110,168,255,${0.18 + 0.25 * pulse.intensity})`,
                      '0 0 0px rgba(110,168,255,0)',
                    ],
                  }
                : { boxShadow: '0 0 0px rgba(110,168,255,0)' }
            }
            transition={pulse.shouldPulse ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
            className={cn(
              'min-w-[180px] max-w-[260px] rounded-xl border px-3 py-2 text-sm backdrop-blur',
              base,
              dimClass,
              selectedClass
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{data.label}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge variant="secondary" className="h-5 px-2 text-[10px]">
                    Mastery {Math.round(data.masteryLevel)}
                  </Badge>
                  <Badge variant="outline" className="h-5 px-2 text-[10px]">
                    Relevance {Math.round(data.examRelevance)}
                  </Badge>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    data.onToggleExpanded();
                  }}
                  className="h-7 w-7"
                  aria-label={data.isExpanded ? 'Collapse' : 'Expand'}
                >
                  {data.isExpanded ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    data.onTogglePinned();
                  }}
                  className="h-7 w-7"
                  aria-label={data.isPinned ? 'Unpin' : 'Pin'}
                >
                  {data.isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-background !bg-primary" />
            <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-background !bg-primary" />
          </motion.div>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="max-w-xs">
          <div className="space-y-1">
            <div className="font-semibold">{data.label}</div>
            <div className="text-xs text-muted-foreground">Mastery: {Math.round(data.masteryLevel)} / 100</div>
            <div className="text-xs text-muted-foreground">Exam relevance: {Math.round(data.examRelevance)} / 100</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const ConceptGraphNode = memo(ConceptGraphNodeInner);

