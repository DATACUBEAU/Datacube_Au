'use client';

import * as React from 'react';
import { splitFileName } from '@/lib/ui/filename-display';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type TruncatedTextProps = {
  text: string;
  className?: string;
  /**
   * Tailwind max-width utility/classes.
   * Defaults are mobile-first and can be overridden per usage.
   */
  maxWidthClass?: string;
  preserveExtension?: boolean;
  /**
   * Optional tooltip content. If not provided, the full text will be used.
   */
  tooltipContent?: React.ReactNode;
};

export function TruncatedText({
  text,
  className,
  maxWidthClass = 'max-w-full',
  preserveExtension = false,
  tooltipContent,
}: TruncatedTextProps) {
  const { stem, extension } = preserveExtension ? splitFileName(text) : { stem: text, extension: null };

  const content = preserveExtension && extension ? (
    <span
      className={cn(
        'flex max-w-full min-w-0 items-center overflow-hidden whitespace-nowrap',
        maxWidthClass,
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate text-ellipsis">{stem}</span>
      <span className="shrink-0">{extension}</span>
    </span>
  ) : (
    <span
      className={cn(
        'block min-w-0 truncate text-ellipsis overflow-hidden whitespace-nowrap',
        maxWidthClass,
        className,
      )}
    >
      {text}
    </span>
  );

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        {content}
      </TooltipTrigger>
      <TooltipContent 
        side="top" 
        className="max-w-[300px] break-words md:max-w-[500px]"
      >
        {tooltipContent || text}
      </TooltipContent>
    </Tooltip>
  );
}
