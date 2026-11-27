export const WHATSAPP_COMMUNITY_URL = 'https://chat.whatsapp.com/DpSUsodSKvi4xcF1lpwdbN';

export function openCommunityLink() {
  if (typeof window === 'undefined') return;
  window.open(WHATSAPP_COMMUNITY_URL, '_blank', 'noopener,noreferrer');
}
