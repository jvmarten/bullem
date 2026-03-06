import { useState, useEffect, useCallback } from 'react';
import { socket } from '../socket.js';
import { VAPID_PUBLIC_KEY } from '../pushConfig.js';

/** Convert a base64url-encoded string to a Uint8Array (for applicationServerKey). */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export type PushState = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed' | 'loading';

export function usePushNotifications() {
  const [state, setState] = useState<PushState>('loading');

  const isSupported = 'serviceWorker' in navigator && 'PushManager' in window;

  // Check current state on mount
  useEffect(() => {
    if (!isSupported) {
      setState('unsupported');
      return;
    }

    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }

    // Check if we already have an active subscription
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        setState(subscription ? 'subscribed' : 'unsubscribed');
      })
      .catch(() => {
        setState('unsubscribed');
      });
  }, [isSupported]);

  // Register service worker on mount
  useEffect(() => {
    if (!isSupported) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service worker registration failed — push will be unsupported
    });
  }, [isSupported]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setState('denied');
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });

      const subJSON = subscription.toJSON();
      const result = await new Promise<{ ok: true } | { error: string }>((resolve) => {
        socket.emit('push:subscribe', {
          endpoint: subJSON.endpoint ?? '',
          keys: subJSON.keys ? { p256dh: subJSON.keys.p256dh ?? '', auth: subJSON.keys.auth ?? '' } : undefined,
        }, resolve);
      });

      if ('error' in result) {
        await subscription.unsubscribe();
        return false;
      }

      setState('subscribed');
      return true;
    } catch {
      return false;
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
      }

      await new Promise<{ ok: true } | { error: string }>((resolve) => {
        socket.emit('push:unsubscribe', resolve);
      });
    } catch {
      // Best-effort cleanup
    }
    setState('unsubscribed');
  }, []);

  return { state, isSupported, subscribe, unsubscribe };
}
