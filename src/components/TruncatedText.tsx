'use client';

import { cn } from '@/lib/utils';

type TruncatedTextProps = {
  text: string;
  className?: string;
  /**
   * Tailwind max-width utility/classes.
   * Defaults are mobile-first and can be overridden per usage.
   */
  maxWidthClass?: string;
  preserveExtension?: boolean;
};

function splitFileName(text: string): { stem: string; extension: string | null } {
  const trimmed = String(text || '');
  const lastDotIndex = trimmed.lastIndexOf('.');
  if (lastDotIndex <= 0 || lastDotIndex === trimmed.length - 1) {
    return { stem: trimmed, extension: null };
  }

  return {
    stem: trimmed.slice(0, lastDotIndex),
    extension: trimmed.slice(lastDotIndex),
  };
}

export function TruncatedText({
  text,
  className,
  maxWidthClass = 'max-w-full',
  preserveExtension = false,
}: TruncatedTextProps) {
  const { stem, extension } = preserveExtension ? splitFileName(text) : { stem: text, extension: null };

  if (preserveExtension && extension) {
    return (
      <span
        className={cn(
          'flex max-w-full min-w-0 items-center overflow-hidden whitespace-nowrap',
          maxWidthClass,
          className,
        )}
        title={text}
      >
        <span className="min-w-0 flex-1 truncate text-ellipsis">{stem}</span>
        <span className="shrink-0">{extension}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'block min-w-0 truncate text-ellipsis overflow-hidden whitespace-nowrap',
        maxWidthClass,
        className,
      )}
      title={text}
    >
      {text}
    </span>
  );
}
