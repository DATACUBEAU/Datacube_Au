export function getPublicSupportEmail(): string | null {
  const value = String(process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '').trim();
  if (!value) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  return value;
}

export function buildSupportMailto(input: {
  subject: string;
  body: string;
}): string | null {
  const email = getPublicSupportEmail();
  if (!email) return null;

  const subject = encodeURIComponent(input.subject);
  const body = encodeURIComponent(input.body);
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

export function openSupportEmail(input: { subject: string; body: string }): boolean {
  if (typeof window === 'undefined') return false;
  const href = buildSupportMailto(input);
  if (!href) return false;
  window.open(href);
  return true;
}
