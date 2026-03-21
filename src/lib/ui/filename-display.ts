export type SplitFileNameResult = {
  stem: string;
  extension: string | null;
};

export function splitFileName(text: string): SplitFileNameResult {
  const trimmed = String(text || '');
  const lastDotIndex = trimmed.lastIndexOf('.');

  if (lastDotIndex <= 0 || lastDotIndex === trimmed.length - 1) {
    return {
      stem: trimmed,
      extension: null,
    };
  }

  return {
    stem: trimmed.slice(0, lastDotIndex),
    extension: trimmed.slice(lastDotIndex),
  };
}
