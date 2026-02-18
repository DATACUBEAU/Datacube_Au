'use client';
import { useNetworkStatus } from '@/components/providers/network-status-provider';

export function useOnlineStatus(): boolean {
  const { isOnline } = useNetworkStatus();
  return isOnline;
}
