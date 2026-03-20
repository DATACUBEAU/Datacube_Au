'use client';

import { Button } from '@/components/ui/button';

type FollowUpSuggestionsProps = {
  prompts: string[];
  onSelect: (prompt: string) => void;
  disabled?: boolean;
};

export function FollowUpSuggestions({
  prompts,
  onSelect,
  disabled = false,
}: FollowUpSuggestionsProps) {
  if (prompts.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Ask Next
      </p>
      <div className="flex flex-wrap gap-2">
        {prompts.map((prompt) => (
          <Button
            key={prompt}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className="h-auto max-w-full min-w-0 rounded-full border-border/70 px-3 py-1.5 text-left text-xs leading-5 whitespace-normal break-words [overflow-wrap:anywhere]"
            onClick={() => onSelect(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>
    </div>
  );
}
