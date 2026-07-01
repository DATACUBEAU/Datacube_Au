'use client';

import * as React from 'react';
import { Send, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  CHAT_COMPOSER_MIN_HEIGHT_PX,
  getChatComposerMaxHeight,
} from './chat-composer-sizing';

export function resizeChatComposerTextarea(
  textarea: HTMLTextAreaElement,
  visibleViewportHeight: number,
  isMobile: boolean,
): void {
  const maxHeight = getChatComposerMaxHeight(visibleViewportHeight, isMobile);
  textarea.style.height = 'auto';
  textarea.style.maxHeight = `${maxHeight}px`;

  const scrollHeight = Math.max(textarea.scrollHeight, CHAT_COMPOSER_MIN_HEIGHT_PX);
  const nextHeight = Math.min(scrollHeight, maxHeight);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
}

type ChatComposerProps = {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  sendDisabled?: boolean;
  isResponding?: boolean;
  onStop?: () => void;
  leftControl?: React.ReactNode;
  topContent?: React.ReactNode;
  statusContent?: React.ReactNode;
  className?: string;
  sendButtonLabel?: string;
  stopButtonLabel?: string;
};

function readViewportHeight(): number {
  if (typeof window === 'undefined') return 0;
  return window.visualViewport?.height || window.innerHeight || 0;
}

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 640px)').matches;
}

export function ChatComposer({
  id = 'message',
  value,
  onValueChange,
  onSubmit,
  textareaRef,
  placeholder,
  ariaLabel,
  disabled = false,
  sendDisabled = false,
  isResponding = false,
  onStop,
  leftControl,
  topContent,
  statusContent,
  className,
  sendButtonLabel = 'Send message',
  stopButtonLabel = 'Stop generation',
}: ChatComposerProps) {
  const internalTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const animationFrameRef = React.useRef<number | null>(null);
  const isComposingRef = React.useRef(false);

  const resizeNow = React.useCallback(() => {
    const textarea = internalTextareaRef.current;
    if (!textarea) return;
    resizeChatComposerTextarea(textarea, readViewportHeight(), isMobileViewport());
  }, []);

  const scheduleResize = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      resizeNow();
    });
  }, [resizeNow]);

  const setTextareaNode = React.useCallback((node: HTMLTextAreaElement | null) => {
    internalTextareaRef.current = node;
    if (textareaRef) {
      textareaRef.current = node;
    }
    if (node) {
      scheduleResize();
    }
  }, [scheduleResize, textareaRef]);

  React.useLayoutEffect(() => {
    resizeNow();
  }, [disabled, placeholder, resizeNow, value]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    window.addEventListener('resize', scheduleResize);
    window.visualViewport?.addEventListener('resize', scheduleResize);
    window.visualViewport?.addEventListener('scroll', scheduleResize);
    void document.fonts?.ready.then(scheduleResize);

    return () => {
      window.removeEventListener('resize', scheduleResize);
      window.visualViewport?.removeEventListener('resize', scheduleResize);
      window.visualViewport?.removeEventListener('scroll', scheduleResize);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [scheduleResize]);

  const canSubmit = value.trim().length > 0 && !disabled && !sendDisabled;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean };
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.repeat ||
      nativeEvent.isComposing ||
      isComposingRef.current
    ) {
      return;
    }

    event.preventDefault();
    if (!canSubmit || isResponding) return;
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <div className={cn(
      'shrink-0 border-t bg-background/95 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2 sm:px-4',
      className,
    )}>
      <div className="relative mx-auto w-full max-w-4xl">
        {topContent}
        <form
          onSubmit={onSubmit}
          className="flex w-full min-w-0 items-end gap-1.5 rounded-[1.75rem] border border-border bg-secondary/85 p-1.5 shadow-sm transition focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring/35 sm:gap-2"
        >
          {leftControl ? (
            <div className="flex shrink-0 items-end pb-0.5">
              {leftControl}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <Label htmlFor={id} className="sr-only">
              {ariaLabel}
            </Label>
            <Textarea
              id={id}
              ref={setTextareaNode}
              value={value}
              placeholder={placeholder}
              aria-label={ariaLabel}
              aria-multiline="true"
              aria-busy={isResponding}
              rows={1}
              disabled={disabled}
              onChange={(event) => {
                onValueChange(event.target.value);
                resizeNow();
              }}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onKeyDown={handleKeyDown}
              className="min-h-12 w-full resize-none overflow-x-hidden overflow-y-hidden break-words border-0 bg-transparent px-2 py-3 text-base leading-6 shadow-none outline-none [overflow-wrap:anywhere] placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-70 md:text-base"
            />
          </div>
          <Button
            type={isResponding ? 'button' : 'submit'}
            size="icon"
            className={cn(
              'mb-0.5 h-10 w-10 shrink-0 self-end rounded-full transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isResponding ? 'bg-destructive hover:bg-destructive/90' : '',
            )}
            disabled={isResponding ? false : !canSubmit}
            aria-label={isResponding ? stopButtonLabel : sendButtonLabel}
            onClick={(event) => {
              if (!isResponding) return;
              event.preventDefault();
              onStop?.();
            }}
          >
            {isResponding ? (
              <span className="relative flex items-center justify-center" aria-hidden="true">
                <Square className="h-4 w-4 fill-current" />
                <span className="absolute inset-0 animate-ping rounded-full bg-destructive opacity-20" />
              </span>
            ) : (
              <Send className="h-5 w-5" aria-hidden="true" />
            )}
          </Button>
        </form>
        {statusContent ? (
          <div className="mt-1 px-3 text-xs text-muted-foreground">
            {statusContent}
          </div>
        ) : null}
      </div>
    </div>
  );
}
