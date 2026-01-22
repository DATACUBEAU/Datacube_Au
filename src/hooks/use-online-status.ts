'use client';
import { useState, useEffect } from 'react';

/**
 * A custom hook to track the user's online status.
 * It provides a boolean state that is true if the browser is online and false otherwise.
 * @returns {boolean} The current online status.
 */
export function useOnlineStatus(): boolean {
  // Initialize state with the current online status.
  // `navigator.onLine` is a browser property that is true if the user is online.
  // We use a function for useState's initial value to ensure this code only runs on the client.
  const [isOnline, setIsOnline] = useState(() =>
    typeof window !== 'undefined' ? window.navigator.onLine : true
  );

  useEffect(() => {
    // This effect should only run in the browser.
    if (typeof window === 'undefined') {
      return;
    }

    // Define handlers for the 'online' and 'offline' events.
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    // Add event listeners to the window object.
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Cleanup function to remove the event listeners when the component unmounts.
    // This is important to prevent memory leaks.
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []); // The empty dependency array ensures this effect runs only once on mount.

  return isOnline;
}
