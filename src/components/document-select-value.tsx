'use client';

import { FileNameText } from '@/components/FileNameText';
import { cn } from '@/lib/utils';

type DocumentSelectValueProps = {
  text?: string | null;
  placeholder: string;
  className?: string;
  placeholderClassName?: string;
  textClassName?: string;
  maxWidthClass?: string;
};

export function DocumentSelectValue({
  text,
  placeholder,
  className,
  placeholderClassName,
  textClassName,
  maxWidthClass = 'max-w-[150px] sm:max-w-[250px]',
}: DocumentSelectValueProps) {
  const normalized = typeof text === 'string' ? text.trim() : '';

  if (!normalized) {
    return (
      <span
        className={cn(
          'block min-w-0 flex-1 truncate text-muted-foreground',
          placeholderClassName,
          className,
        )}
      >
        {placeholder}
      </span>
    );
  }

  return (
    <FileNameText
      text={normalized}
      className={cn('font-medium text-foreground', textClassName, className)}
      maxWidthClass={maxWidthClass}
    />
  );
}
