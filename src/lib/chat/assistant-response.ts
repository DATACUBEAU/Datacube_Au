export type AssistantResponseBlock =
  | { type: 'heading'; content: string }
  | { type: 'paragraph'; content: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] };

const INTERNAL_TAG_RE = /\[(?![\d,\s]+\])[^\]]+\]/g;
const DECORATIVE_SEPARATOR_RE = /^\s*(?:\*{3,}|-{3,}|_{3,})\s*$/gm;
const SOURCE_HEADER_RE = /^\s*sources?\s*:?\s*$/i;
const SOURCE_WEB_LOOKUP_RE = /^\s*source:\s*web\s*lookup\b/i;
const BULLET_LINE_RE = /^\s*[-*•]\s+/;
const ORDERED_LINE_RE = /^\s*\d+\.\s+/;
const KNOWN_HEADING_RE =
  /^(key takeaway|takeaway|overview|summary|short summary|quick summary|main points?|key points?|core ideas?|follow-up prompts?|suggested follow-up prompts?|next steps?)$/i;
const SOURCE_FILE_LINE_RE =
  /^(?:[a-z0-9 _./-]+\.(?:txt|pdf|doc|docx|ppt|pptx|md|csv|xlsx))(?:\s*,\s*[a-z0-9 _./-]+\.(?:txt|pdf|doc|docx|ppt|pptx|md|csv|xlsx))*$/i;

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => toText(entry)).join('\n');
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeLine(line: string): string {
  if (BULLET_LINE_RE.test(line)) {
    return line.replace(BULLET_LINE_RE, '- ').trimEnd();
  }
  return line.replace(/\t/g, ' ').replace(/[ \u00A0]+$/g, '');
}

function stripSourceSection(lines: string[]): string[] {
  const nextLines: string[] = [];
  let skippingSources = false;
  let skippedSourceEntries = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!skippingSources && (SOURCE_HEADER_RE.test(line) || SOURCE_WEB_LOOKUP_RE.test(line))) {
      skippingSources = true;
      skippedSourceEntries = 0;
      continue;
    }

    if (skippingSources) {
      if (!line) {
        if (skippedSourceEntries > 0) {
          skippingSources = false;
        }
        continue;
      } else if (SOURCE_FILE_LINE_RE.test(line) || line.length <= 120) {
        skippedSourceEntries += 1;
        continue;
      } else {
        skippingSources = false;
      }
    }

    nextLines.push(rawLine);
  }

  return nextLines;
}

function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (BULLET_LINE_RE.test(trimmed) || ORDERED_LINE_RE.test(trimmed)) return false;
  if (KNOWN_HEADING_RE.test(trimmed)) return true;
  if (/^[A-Z0-9][A-Za-z0-9 '’:/-]{0,70}:$/.test(trimmed)) return true;
  if (/^[A-Z][A-Z0-9 '’/-]{2,70}$/.test(trimmed)) return true;
  return false;
}

function cleanListItem(line: string): string {
  return line
    .replace(BULLET_LINE_RE, '')
    .replace(ORDERED_LINE_RE, '')
    .trim();
}

function dedupeStrings(values: string[], excluded: string[] = []): string[] {
  const blocked = new Set(excluded.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  const next: string[] = [];

  for (const raw of values) {
    const value = raw.trim().replace(/\s+/g, ' ');
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key) || blocked.has(key)) continue;
    seen.add(key);
    next.push(value);
  }

  return next;
}

function stripReplyQuote(question: string): string {
  const lines = question
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('>'));

  return lines.length > 0 ? lines[lines.length - 1] : question.trim();
}

function extractTopic(question: string, documentName?: string | null): string | null {
  const cleaned = stripReplyQuote(question).replace(/[?!.]+$/g, '').trim();
  if (!cleaned) return documentName?.trim() || null;

  const patterns = [
    /(?:what is|what's|define|explain|describe|tell me about)\s+(.+)/i,
    /(?:summari[sz]e|key takeaways? from|key takeaways? of|main points? of)\s+(.+)/i,
    /(?:quiz me on|practice questions? on)\s+(.+)/i,
    /(?:difference between|compare)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      return candidate.replace(/\b(this|that|the)\s+(document|topic|chapter)\b/gi, '').trim() || null;
    }
  }

  if (cleaned.split(/\s+/).length <= 5) {
    return cleaned;
  }

  return documentName?.trim() || null;
}

function makePromptTopic(topic: string | null, fallback: string): string {
  return topic && topic.trim().length > 0 ? topic.trim() : fallback;
}

export function formatAssistantResponseText(value: unknown): string {
  const raw = toText(value)
    .replace(/\r\n/g, '\n')
    .replace(INTERNAL_TAG_RE, '')
    .replace(/\*\*/g, '')
    .replace(DECORATIVE_SEPARATOR_RE, '');

  const cleanedLines = stripSourceSection(raw.split('\n').map((line) => normalizeLine(line)));
  const compacted: string[] = [];

  for (const line of cleanedLines) {
    const trimmed = line.trim();
    const previous = compacted[compacted.length - 1] ?? '';
    if (!trimmed) {
      if (previous !== '') compacted.push('');
      continue;
    }
    compacted.push(trimmed);
  }

  while (compacted[0] === '') compacted.shift();
  while (compacted[compacted.length - 1] === '') compacted.pop();

  return compacted.join('\n');
}

export function formatAssistantThought(value?: unknown): string | undefined {
  const raw = formatAssistantResponseText(value ?? '');
  const cleaned = raw
    .replace(/\b(exploratory|retrieving|retrieval|syncing|chunk(?:s)?|pipeline|lookup|document(?:s)?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length > 0 ? cleaned : undefined;
}

export function parseAssistantResponseBlocks(content: string): AssistantResponseBlock[] {
  const lines = formatAssistantResponseText(content).split('\n');
  const blocks: AssistantResponseBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? '';
    if (!line) {
      index += 1;
      continue;
    }

    if (looksLikeHeading(line)) {
      blocks.push({ type: 'heading', content: line.replace(/:$/, '') });
      index += 1;
      continue;
    }

    if (BULLET_LINE_RE.test(line)) {
      const items: string[] = [];
      while (index < lines.length && BULLET_LINE_RE.test(lines[index].trim())) {
        items.push(cleanListItem(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    if (ORDERED_LINE_RE.test(line)) {
      const items: string[] = [];
      while (index < lines.length && ORDERED_LINE_RE.test(lines[index].trim())) {
        items.push(cleanListItem(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index]?.trim() ?? '';
      if (!current) break;
      if (looksLikeHeading(current) || BULLET_LINE_RE.test(current) || ORDERED_LINE_RE.test(current)) break;
      paragraphLines.push(current);
      index += 1;
    }

    blocks.push({ type: 'paragraph', content: paragraphLines.join(' ') });
  }

  return blocks;
}

export function normalizeAssistantCitations(citations: unknown): string[] {
  if (!Array.isArray(citations)) return [];

  const labels = citations
    .map((citation) => {
      if (typeof citation === 'string') return citation.trim();
      if (!citation || typeof citation !== 'object') return '';
      const row = citation as Record<string, unknown>;
      const value =
        row.fileName ||
        row.filename ||
        row.name ||
        row.title ||
        row.documentTitle ||
        row.path ||
        '';
      return typeof value === 'string' ? value.trim() : '';
    })
    .filter(Boolean);

  return dedupeStrings(labels);
}

export function buildFollowUpSuggestions(input: {
  answer: string;
  userQuestion?: string | null;
  documentName?: string | null;
  isGlobal?: boolean;
}): string[] {
  const answer = formatAssistantResponseText(input.answer);
  const question = String(input.userQuestion || '').trim();
  const isGlobal = input.isGlobal === true;
  const scopeLabel = isGlobal ? 'this topic' : 'this document';
  const topic = makePromptTopic(extractTopic(question, input.documentName), scopeLabel);

  const summaryIntent = /summari[sz]e|summary|key takeaways?|main points?|what is this document about/i.test(question);
  const comparisonIntent = /difference between|compare|vs\b/i.test(question);
  const definitionIntent = /what is|what's|define|explain|describe|tell me about/i.test(question);
  const examIntent = /exam|quiz|practice question|revision/i.test(question) || /exam|quiz|revision/i.test(answer);

  if (comparisonIntent) {
    return dedupeStrings([
      'Can you compare these ideas in a simple table?',
      'Which difference matters most in exams?',
      'Can you give one example of each?',
    ]);
  }

  if (summaryIntent) {
    return dedupeStrings([
      'Can you explain this in simpler words?',
      isGlobal ? 'Can you turn this into short study notes?' : 'Can you turn this into short study notes?',
      examIntent ? 'Can you quiz me on this topic?' : isGlobal ? `What are the most important points about ${topic}?` : 'What are the 5 most important exam points from this document?',
    ]);
  }

  if (definitionIntent) {
    return dedupeStrings([
      `Can you explain ${topic} in simpler words?`,
      `Can you give a real-life example of ${topic}?`,
      examIntent ? `Can you quiz me on ${topic}?` : `How would ${topic} appear in an exam question?`,
    ]);
  }

  return dedupeStrings([
    'Can you explain this in simpler words?',
    isGlobal ? 'Can you give me a practical example?' : 'Can you turn this into short study notes?',
    examIntent ? 'Can you quiz me on this topic?' : isGlobal ? `What should I ask next about ${topic}?` : 'Can you quiz me on this topic?',
  ], [question]);
}
