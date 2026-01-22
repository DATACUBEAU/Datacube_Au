'use client';
import { motion } from 'framer-motion';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Fragment } from 'react';

// This interface defines the structure for a parsed concept from the AU's text output.
interface Concept {
  term: string;
  details: string;
}

/**
 * Parses the AU-generated string into a more structured format.
 * It looks for the pattern: 'Concept' (Definition).
 *
 * @param {string} content - The raw string output from the AU.
 * @returns An array where each element is either a plain string segment or a Concept object.
 */
const parseConceptMap = (content: string): (string | Concept)[] => {
  const parts: (string | Concept)[] = [];
  // This regex looks for a term in single quotes, followed by its definition in parentheses.
  const regex = /'([^']+)'\s*\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add the plain text that comes before the matched concept.
    if (match.index > lastIndex) {
      parts.push(content.substring(lastIndex, match.index));
    }

    const term = match[1];
    const details = match[2];
    
    if (term && details) {
        // Add the concept object, which will be rendered as an interactive element.
        parts.push({ term, details });
    }

    lastIndex = regex.lastIndex;
  }

  // Add any remaining plain text after the last match.
  if (lastIndex < content.length) {
    parts.push(content.substring(lastIndex));
  }

  return parts;
};

// Animation variants for Framer Motion.
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05, // A subtle delay between each part's animation.
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: 'easeOut',
    },
  },
};

export default function InteractiveConceptMap({ content }: { content: string }) {
  const parsedContent = parseConceptMap(content);

  // If parsing results in no interactive parts, just show the plain text.
  if (parsedContent.every(part => typeof part === 'string')) {
    return <p className="whitespace-pre-wrap leading-relaxed">{content}</p>;
  }

  return (
    <motion.p
      className="leading-loose"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {parsedContent.map((part, index) => (
        <Fragment key={index}>
          {typeof part === 'string' ? (
            // Render plain text segments directly.
            <motion.span variants={itemVariants}>{part}</motion.span>
          ) : (
            // Render interactive concepts with a Popover.
            <Popover>
              <PopoverTrigger asChild>
                <motion.span
                  variants={itemVariants}
                  className="cursor-pointer rounded-md bg-primary/10 px-1 py-0.5 font-semibold text-primary transition-all hover:bg-primary/20"
                >
                  {part.term}
                </motion.span>
              </PopoverTrigger>
              <PopoverContent className="w-auto max-w-[90vw] sm:max-w-sm" side="top" align="center">
                <div className="space-y-2">
                  <h4 className="font-bold">{part.term}</h4>
                  <p className="text-sm text-muted-foreground">{part.details}</p>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </Fragment>
      ))}
    </motion.p>
  );
}
