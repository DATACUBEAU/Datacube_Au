export type SupportedUploadKind = 'pdf' | 'txt' | 'md' | 'docx' | 'pptx';

export const supportedExtensions: Record<SupportedUploadKind, string> = {
  pdf: '.pdf',
  txt: '.txt',
  md: '.md',
  docx: '.docx',
  pptx: '.pptx',
};

export function normalizeFileName(name: string): string {
  // Filename validation: non-empty, <= 255 chars
  if (!name || name.length > 255) {
    return 'unnamed_file';
  }
  return name.replace(/[^\w.\-]/g, '_');
}

export function validateGuestSessionId(id: string | null | undefined): { valid: boolean; error?: string } {
  if (!id) return { valid: true }; // Allowed to be missing if user is authenticated
  const uuidRegex = /^[0-9a-fA-F-]{36}$/;
  if (!uuidRegex.test(id)) {
    return { valid: false, error: 'Invalid guest session ID format.' };
  }
  return { valid: true };
}

export function validateFile(file: File): { valid: boolean; error?: string } {
  // 1. Filename validation
  if (!file.name || file.name.length > 255) {
    return { valid: false, error: 'Filename must be 1-255 characters.' };
  }

  // 2. File type validation (whitelist)
  const kind = detectUploadKind(file);
  if (!kind) {
    return { valid: false, error: 'Unsupported file type. Please upload PDF, TXT, MD, DOCX, or PPTX.' };
  }

  // 3. File size validation (50MB cap mentioned in UI)
  const MAX_SIZE = 50 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return { valid: false, error: 'File size exceeds 50MB limit.' };
  }

  return { valid: true };
}

export function validateQuery(query: string): { valid: boolean; error?: string } {
  // Query length validation: cap (~2000 chars)
  if (!query || query.trim().length === 0) {
    return { valid: false, error: 'Query cannot be empty.' };
  }
  if (query.length > 2000) {
    return { valid: false, error: 'Query is too long (max 2000 characters).' };
  }
  return { valid: true };
}

export function getFileExtensionLower(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx === -1) return '';
  return name.slice(idx).toLowerCase();
}

export function isSupportedExtension(ext: string): ext is `.${SupportedUploadKind}` {
  return Object.values(supportedExtensions).includes(ext as any);
}

export function detectUploadKind(file: File): SupportedUploadKind | null {
  const ext = getFileExtensionLower(file.name);
  switch (ext) {
    case '.pdf':
      return 'pdf';
    case '.txt':
      return 'txt';
    case '.md':
      return 'md';
    case '.docx':
      return 'docx';
    case '.pptx':
      return 'pptx';
    default:
      return null;
  }
}
