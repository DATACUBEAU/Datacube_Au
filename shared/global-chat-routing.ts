export const GLOBAL_CHAT_TITLE = 'Datacube AU Global Chat';
export const GLOBAL_CHAT_WELCOME_COPY =
  'Hello! I’m Datacube AU Global Chat. I can help explain concepts, answer learning questions, and support your study flow. What do you want help with right now?';

export type GlobalChatNavIntent =
  | 'documents'
  | 'goals'
  | 'activity'
  | 'settings';

export type GlobalChatNavAction = {
  intent: GlobalChatNavIntent;
  href: string;
  label: string;
  available: boolean;
};

export type ChatTemplateResponse = {
  answer: string;
  navAction?: GlobalChatNavAction | null;
};

function normalizeInput(message: string): string {
  return String(message || '').trim().toLowerCase();
}

function isGreeting(input: string): boolean {
  return /^(hi|hello|hey|yo|howdy|good morning|good afternoon|good evening)[!. ]*$/i.test(input);
}

function isThanks(input: string): boolean {
  return /^(thanks|thank you|thx|ty|tysm|appreciate it)[!. ]*$/i.test(input) || /^(ok|okay|cool|nice)[!. ]*thanks[!. ]*$/i.test(input);
}

function matchesAny(input: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(input));
}

export function resolveGlobalChatNavAction(message: string): GlobalChatNavAction | null {
  const normalized = normalizeInput(message);
  if (!normalized) return null;

  if (
    matchesAny(normalized, [
      /\b(documents?|files?|uploads?|library)\b/,
      /\b(open|go to|take me to|show|view|browse|manage)\b.*\b(documents?|files?|uploads?|library)\b/,
    ])
  ) {
    return {
      intent: 'documents',
      href: '/dashboard/documents',
      label: 'Open Documents',
      available: true,
    };
  }

  if (
    matchesAny(normalized, [
      /\b(goals?)\b/,
      /\b(review|open|show|view|check)\b.*\b(goals?)\b/,
    ])
  ) {
    return {
      intent: 'goals',
      href: '/goals',
      label: 'Open Goals',
      available: false,
    };
  }

  if (
    matchesAny(normalized, [
      /\b(activity summary|recent activity|activity)\b/,
      /\b(check|show|open|view|review)\b.*\b(activity summary|recent activity|activity)\b/,
    ])
  ) {
    return {
      intent: 'activity',
      href: '/activity',
      label: 'Open Activity',
      available: false,
    };
  }

  if (
    matchesAny(normalized, [
      /\b(settings?|preferences?)\b/,
      /\b(open|go to|take me to|show|view|manage|review)\b.*\b(settings?|preferences?)\b/,
    ])
  ) {
    return {
      intent: 'settings',
      href: '/dashboard/settings',
      label: 'Open Settings',
      available: true,
    };
  }

  return null;
}

export function matchGlobalChatTemplate(message: string): ChatTemplateResponse | null {
  const normalized = normalizeInput(message);
  if (!normalized) return null;

  if (isGreeting(normalized)) {
    return { answer: GLOBAL_CHAT_WELCOME_COPY, navAction: null };
  }

  if (isThanks(normalized)) {
    return { answer: "You're welcome.", navAction: null };
  }

  const navAction = resolveGlobalChatNavAction(normalized);
  if (!navAction) return null;

  if (navAction.available) {
    return {
      answer: `Navigating to ${navAction.label}.`,
      navAction,
    };
  }

  return {
    answer: "That section isn't available yet.",
    navAction: null,
  };
}
