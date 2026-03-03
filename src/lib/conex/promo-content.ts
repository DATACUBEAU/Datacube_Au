import { PROMO_PRO_END_LAGOS_ISO } from '../tier/policy';

export type PromoContentConfig = {
  introText: string;
  pricingTemplate: string;
  endsTemplate: string;
  effectiveDateLabel: string;
  monthlyPriceNgn: number;
  weeklyPriceNgn: number;
  promoEndsAtLagosIso: string;
  timezoneLabel: string;
};

export type PromoContentDraft = {
  introText: string;
  pricingTemplate: string;
  endsTemplate: string;
  effectiveDateLabel: string;
  monthlyPriceNgn: string;
  weeklyPriceNgn: string;
  promoEndsAtLagosIso: string;
  timezoneLabel: string;
};

export const DEFAULT_PROMO_CONTENT_CONFIG: PromoContentConfig = {
  introText: 'You are currently on Promo Pro.',
  pricingTemplate: 'On {effectiveDate}, Pro becomes NGN {monthlyPrice}/month or NGN {weeklyPrice}/week.',
  endsTemplate: 'Promo ends at {promoEndsAt} {timezone} time.',
  effectiveDateLabel: 'April 2nd, 2026',
  monthlyPriceNgn: 4500,
  weeklyPriceNgn: 1500,
  promoEndsAtLagosIso: PROMO_PRO_END_LAGOS_ISO,
  timezoneLabel: 'Africa/Lagos',
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown, fallback: string): string {
  const next = String(value ?? '').trim();
  return next || fallback;
}

function asPositiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function normalizeIsoLike(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return fallback;
  return raw;
}

export function normalizePromoContentConfig(raw: unknown): PromoContentConfig {
  const row = asRecord(raw);
  return {
    introText: asTrimmedString(row.introText, DEFAULT_PROMO_CONTENT_CONFIG.introText),
    pricingTemplate: asTrimmedString(row.pricingTemplate, DEFAULT_PROMO_CONTENT_CONFIG.pricingTemplate),
    endsTemplate: asTrimmedString(row.endsTemplate, DEFAULT_PROMO_CONTENT_CONFIG.endsTemplate),
    effectiveDateLabel: asTrimmedString(row.effectiveDateLabel, DEFAULT_PROMO_CONTENT_CONFIG.effectiveDateLabel),
    monthlyPriceNgn: asPositiveInteger(row.monthlyPriceNgn, DEFAULT_PROMO_CONTENT_CONFIG.monthlyPriceNgn),
    weeklyPriceNgn: asPositiveInteger(row.weeklyPriceNgn, DEFAULT_PROMO_CONTENT_CONFIG.weeklyPriceNgn),
    promoEndsAtLagosIso: normalizeIsoLike(row.promoEndsAtLagosIso, DEFAULT_PROMO_CONTENT_CONFIG.promoEndsAtLagosIso),
    timezoneLabel: asTrimmedString(row.timezoneLabel, DEFAULT_PROMO_CONTENT_CONFIG.timezoneLabel),
  };
}

export function toPromoContentDraft(config: PromoContentConfig): PromoContentDraft {
  return {
    introText: config.introText,
    pricingTemplate: config.pricingTemplate,
    endsTemplate: config.endsTemplate,
    effectiveDateLabel: config.effectiveDateLabel,
    monthlyPriceNgn: String(config.monthlyPriceNgn),
    weeklyPriceNgn: String(config.weeklyPriceNgn),
    promoEndsAtLagosIso: config.promoEndsAtLagosIso,
    timezoneLabel: config.timezoneLabel,
  };
}

export function validatePromoContentDraft(
  draft: PromoContentDraft,
): { ok: boolean; errors: string[]; config: PromoContentConfig } {
  const errors: string[] = [];
  const base = normalizePromoContentConfig({
    ...DEFAULT_PROMO_CONTENT_CONFIG,
    ...draft,
  });

  const monthlyRaw = String(draft.monthlyPriceNgn ?? '').trim();
  const weeklyRaw = String(draft.weeklyPriceNgn ?? '').trim();
  const monthlyOk = /^\d+$/.test(monthlyRaw) && Number(monthlyRaw) > 0;
  const weeklyOk = /^\d+$/.test(weeklyRaw) && Number(weeklyRaw) > 0;

  if (!base.introText) errors.push('Intro text is required.');
  if (!base.pricingTemplate) errors.push('Pricing template is required.');
  if (!base.endsTemplate) errors.push('Ending template is required.');
  if (!base.effectiveDateLabel) errors.push('Effective date label is required.');
  if (!base.timezoneLabel) errors.push('Timezone label is required.');

  if (!monthlyOk) errors.push('Monthly price must be a positive integer.');
  if (!weeklyOk) errors.push('Weekly price must be a positive integer.');
  if (!Number.isFinite(new Date(base.promoEndsAtLagosIso).getTime())) {
    errors.push('Promo end datetime must be a valid ISO-like date.');
  }

  const config: PromoContentConfig = {
    ...base,
    monthlyPriceNgn: monthlyOk ? Math.floor(Number(monthlyRaw)) : DEFAULT_PROMO_CONTENT_CONFIG.monthlyPriceNgn,
    weeklyPriceNgn: weeklyOk ? Math.floor(Number(weeklyRaw)) : DEFAULT_PROMO_CONTENT_CONFIG.weeklyPriceNgn,
  };

  return { ok: errors.length === 0, errors, config };
}

function formatNgn(value: number): string {
  return Math.floor(Math.max(0, value)).toLocaleString('en-US');
}

function replaceTokens(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_whole, token: string) => tokens[token] ?? '');
}

export function formatPromoEndsAtLabel(isoLike: string): string {
  const parsed = new Date(isoLike);
  if (!Number.isFinite(parsed.getTime())) {
    return new Date(DEFAULT_PROMO_CONTENT_CONFIG.promoEndsAtLagosIso).toLocaleString('en-US', {
      timeZone: 'Africa/Lagos',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return parsed.toLocaleString('en-US', {
    timeZone: 'Africa/Lagos',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function buildPromoCopy(
  config: PromoContentConfig,
  promoEndsAtLabel: string,
): { intro: string; pricing: string; ending: string } {
  const tokens = {
    effectiveDate: config.effectiveDateLabel,
    monthlyPrice: formatNgn(config.monthlyPriceNgn),
    weeklyPrice: formatNgn(config.weeklyPriceNgn),
    promoEndsAt: promoEndsAtLabel,
    timezone: config.timezoneLabel,
  };

  return {
    intro: config.introText,
    pricing: replaceTokens(config.pricingTemplate, tokens),
    ending: replaceTokens(config.endsTemplate, tokens),
  };
}
