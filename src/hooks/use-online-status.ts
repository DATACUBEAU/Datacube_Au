'use client';
import { useNetworkStatus } from '@/components/providers/network-status-provider';

export function useConnectivityStatus() {
  const network = useNetworkStatus();
  return {
    ...network,
    isOffline: network.networkState === 'offline',
    isDegraded: network.networkState === 'degraded',
    isReadOnly: network.networkState !== 'online',
    canPerformNetworkMutations: network.networkState === 'online',
  };
}

export function useOnlineStatus(): boolean {
  return useConnectivityStatus().isOnline;
}
