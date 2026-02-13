import { createHash } from 'crypto';

/**
 * Deterministic chunking using a fixed character window.
 * In a real production app, you might use token-based splitting (e.g. tiktoken).
 */
export function deterministicChunking(text: string, size = 1000, overlap = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    const chunk = text.slice(start, end);
    chunks.push(chunk);
    
    if (end === text.length) break;
    start += size - overlap;
  }
  
  return chunks.filter(c => c.trim().length > 0);
}

/**
 * Computes SHA-256 hash of a string.
 */
export function computeHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Structured logger
 */
export const logger = {
  info: (message: string, data?: any) => {
    console.log(JSON.stringify({ level: 'info', message, timestamp: new Date().toISOString(), ...data }));
  },
  warn: (message: string, data?: any) => {
    console.warn(JSON.stringify({ level: 'warn', message, timestamp: new Date().toISOString(), ...data }));
  },
  error: (message: string, error?: any) => {
    console.error(JSON.stringify({ 
      level: 'error', 
      message, 
      timestamp: new Date().toISOString(), 
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    }));
  }
};
