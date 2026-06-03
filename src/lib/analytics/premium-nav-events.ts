/**
 * Premium Nav Discovery Analytics
 *
 * Fires structured CustomEvents on `window` under the name "au:analytics".
 * Subscribe externally to wire into PostHog, GA4, Mixpanel, etc:
 *
 *   window.addEventListener('au:analytics', (e) => {
 *     const { event, plan, featureKey, source } = (e as CustomEvent).detail;
 *     posthog.capture(event, { plan, featureKey, source });
 *   });
 *
 * Events are also console.info'd in development for easy verification.
 */

export type PremiumNavEventName =
  | 'feature_locked_click'
  | 'upgrade_modal_open'
  | 'upgrade_cta_click';

export interface PremiumNavEventPayload {
  event: PremiumNavEventName;
  plan: string;
  featureKey: string;
  source: string;
}

function dispatch(payload: PremiumNavEventPayload) {
  if (typeof window === 'undefined') return;

  if (process.env.NODE_ENV === 'development') {
    console.info('[au:analytics]', payload);
  }

  window.dispatchEvent(
    new CustomEvent<PremiumNavEventPayload>('au:analytics', {
      detail: payload,
      bubbles: false,
    })
  );
}

/**
 * Fired when a free user clicks a locked nav item.
 */
export function trackLockedClick(featureKey: string, plan: string, source = 'sidebar_nav') {
  dispatch({ event: 'feature_locked_click', plan, featureKey, source });
}

/**
 * Fired when the upgrade modal becomes visible.
 */
export function trackUpgradeModalOpen(featureKey: string, plan: string, source = 'sidebar_nav') {
  dispatch({ event: 'upgrade_modal_open', plan, featureKey, source });
}

/**
 * Fired when the user clicks "Upgrade Now" inside the upgrade modal.
 */
export function trackUpgradeCTAClick(featureKey: string, plan: string, source = 'upgrade_modal') {
  dispatch({ event: 'upgrade_cta_click', plan, featureKey, source });
}
