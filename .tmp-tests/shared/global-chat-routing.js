"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GLOBAL_CHAT_WELCOME_COPY = exports.GLOBAL_CHAT_TITLE = void 0;
exports.resolveGlobalChatNavAction = resolveGlobalChatNavAction;
exports.matchGlobalChatTemplate = matchGlobalChatTemplate;
exports.GLOBAL_CHAT_TITLE = 'Datacube AU Global Chat';
exports.GLOBAL_CHAT_WELCOME_COPY = 'Hello! I’m Datacube AU Global Chat. I can help explain concepts, answer learning questions, and support your study flow. What do you want help with right now?';
function normalizeInput(message) {
    return String(message || '').trim().toLowerCase();
}
function isGreeting(input) {
    return /^(hi|hello|hey|yo|howdy|good morning|good afternoon|good evening)[!. ]*$/i.test(input);
}
function isThanks(input) {
    return /^(thanks|thank you|thx|ty|tysm|appreciate it)[!. ]*$/i.test(input) || /^(ok|okay|cool|nice)[!. ]*thanks[!. ]*$/i.test(input);
}
function matchesAny(input, patterns) {
    return patterns.some((pattern) => pattern.test(input));
}
function resolveGlobalChatNavAction(message) {
    const normalized = normalizeInput(message);
    if (!normalized)
        return null;
    if (matchesAny(normalized, [
        /\b(documents?|files?|uploads?|library)\b/,
        /\b(open|go to|take me to|show|view|browse|manage)\b.*\b(documents?|files?|uploads?|library)\b/,
    ])) {
        return {
            intent: 'documents',
            href: '/dashboard/documents',
            label: 'Open Documents',
            available: true,
        };
    }
    if (matchesAny(normalized, [
        /\b(goals?)\b/,
        /\b(review|open|show|view|check)\b.*\b(goals?)\b/,
    ])) {
        return {
            intent: 'goals',
            href: '/goals',
            label: 'Open Goals',
            available: false,
        };
    }
    if (matchesAny(normalized, [
        /\b(activity summary|recent activity|activity)\b/,
        /\b(check|show|open|view|review)\b.*\b(activity summary|recent activity|activity)\b/,
    ])) {
        return {
            intent: 'activity',
            href: '/activity',
            label: 'Open Activity',
            available: false,
        };
    }
    if (matchesAny(normalized, [
        /\b(settings?|preferences?)\b/,
        /\b(open|go to|take me to|show|view|manage|review)\b.*\b(settings?|preferences?)\b/,
    ])) {
        return {
            intent: 'settings',
            href: '/dashboard/settings',
            label: 'Open Settings',
            available: true,
        };
    }
    return null;
}
function matchGlobalChatTemplate(message) {
    const normalized = normalizeInput(message);
    if (!normalized)
        return null;
    if (isGreeting(normalized)) {
        return { answer: exports.GLOBAL_CHAT_WELCOME_COPY, navAction: null };
    }
    if (isThanks(normalized)) {
        return { answer: "You're welcome.", navAction: null };
    }
    const navAction = resolveGlobalChatNavAction(normalized);
    if (!navAction)
        return null;
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
