'use client';

import { useEffect, useMemo, useState } from 'react';
import InteractiveConceptMap from '@/components/interactive-concept-map';
import { parseAssistantResponseBlocks } from '@/lib/chat/assistant-response';

type AssistantResponseBodyProps = {
  content: string;
  shouldAnimate?: boolean;
};

export function AssistantResponseBody({
  content,
  shouldAnimate = true,
}: AssistantResponseBodyProps) {
  const [displayedContent, setDisplayedContent] = useState(shouldAnimate ? '' : content);
  const [isTyping, setIsTyping] = useState(shouldAnimate);

  useEffect(() => {
    if (!shouldAnimate) {
      setDisplayedContent(content);
      setIsTyping(false);
      return;
    }

    setDisplayedContent('');
    setIsTyping(true);
    let index = 0;
    const interval = window.setInterval(() => {
      index += 1;
      setDisplayedContent(content.slice(0, index));
      if (index >= content.length) {
        window.clearInterval(interval);
        setIsTyping(false);
      }
    }, 10);

    return () => window.clearInterval(interval);
  }, [content, shouldAnimate]);

  const blocks = useMemo(() => parseAssistantResponseBlocks(displayedContent), [displayedContent]);

  return (
    <div className="space-y-4 text-sm leading-7 text-foreground">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <h4 key={`heading-${index}`} className="text-sm font-semibold tracking-tight text-foreground">
              {block.content}
            </h4>
          );
        }

        if (block.type === 'ul') {
          return (
            <ul key={`ul-${index}`} className="list-disc space-y-2 pl-5 marker:text-primary/70">
              {block.items.map((item, itemIndex) => (
                <li key={`ul-item-${itemIndex}`}>
                  <InteractiveConceptMap content={item} />
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={`ol-${index}`} className="list-decimal space-y-2 pl-5 marker:text-primary/70">
              {block.items.map((item, itemIndex) => (
                <li key={`ol-item-${itemIndex}`}>
                  <InteractiveConceptMap content={item} />
                </li>
              ))}
            </ol>
          );
        }

        return (
          <div key={`paragraph-${index}`} className="whitespace-normal">
            <InteractiveConceptMap content={block.content} />
          </div>
        );
      })}

      {isTyping ? (
        <span className="inline-block h-3.5 w-1.5 animate-pulse align-middle bg-primary" />
      ) : null}
    </div>
  );
}
