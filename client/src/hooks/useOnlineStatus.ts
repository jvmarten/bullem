import { useState, useEffect } from 'react';

/**
 * Tracks browser online/offline status via the Navigator.onLine API.
 * Returns `false` when the device has no network connectivity (e.g. airplane
 * mode, Wi-Fi lost). This is used to show an offline banner and guide users
 * toward local bot games that work fully offline.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
