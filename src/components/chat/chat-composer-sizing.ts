export const CHAT_COMPOSER_MIN_HEIGHT_PX = 48;
export const CHAT_COMPOSER_DESKTOP_MAX_HEIGHT_PX = 220;
export const CHAT_COMPOSER_MOBILE_VIEWPORT_RATIO = 0.4;

export function getChatComposerMaxHeight(visibleViewportHeight: number, isMobile: boolean): number {
  if (!isMobile || !Number.isFinite(visibleViewportHeight) || visibleViewportHeight <= 0) {
    return CHAT_COMPOSER_DESKTOP_MAX_HEIGHT_PX;
  }

  return Math.max(
    CHAT_COMPOSER_MIN_HEIGHT_PX,
    Math.min(
      CHAT_COMPOSER_DESKTOP_MAX_HEIGHT_PX,
      Math.floor(visibleViewportHeight * CHAT_COMPOSER_MOBILE_VIEWPORT_RATIO),
    ),
  );
}
