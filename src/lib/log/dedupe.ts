const seen = new Set<string>();

export function shouldDedupe(key: string): boolean {
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}

export function logOnce(level: 'log' | 'warn' | 'error', key: string, ...args: any[]) {
  if (shouldDedupe(`${level}:${key}`)) return;
  (console[level] ?? console.log)(...args);
}

export function runOnce(key: string, fn: () => void) {
  if (shouldDedupe(`run:${key}`)) return;
  fn();
}

