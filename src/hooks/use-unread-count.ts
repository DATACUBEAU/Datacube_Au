
import { useChatRuntime } from '@/components/providers/chat-runtime-provider';

export function useUnreadCount() {
  const { unreadCount } = useChatRuntime();
  return unreadCount;
}
