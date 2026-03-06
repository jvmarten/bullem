import webpush from 'web-push';
import type { PushSubscription } from 'web-push';
import type { PlayerId, PushSubscriptionJSON } from '@bull-em/shared';
import logger from '../logger.js';

// VAPID public key — must match the key in client/src/pushConfig.ts.
// Read from env so it can be configured per-environment; falls back to the
// hardcoded production key for convenience.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
  ?? 'BMMe4YdLfz9yXpst3eyO4JaTfdZDPdamLuYvR431cM_c77BDTpZYyeqE7K6PDzb8JyKTBMbGHh1FBNUugZpm7M8';

const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

/**
 * Manages Web Push subscriptions and sends turn notifications.
 *
 * // TODO(scale): Move push subscriptions to Redis/PostgreSQL when user
 * // accounts are tied to push subscriptions. Current in-memory Map is lost
 * // on restart and doesn't work across multiple server instances.
 */
export class PushManager {
  private subscriptions = new Map<PlayerId, PushSubscription>();
  private readonly enabled: boolean;

  constructor() {
    if (VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      this.enabled = true;
      logger.info('Web Push notifications enabled');
    } else {
      this.enabled = false;
      logger.info('Web Push notifications disabled (VAPID_PRIVATE_KEY or VAPID_SUBJECT not set)');
    }
  }

  /** Register a push subscription for a player. */
  subscribe(playerId: PlayerId, subscription: PushSubscriptionJSON): void {
    if (!this.enabled) return;
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      logger.warn({ playerId }, 'Invalid push subscription — missing endpoint or keys');
      return;
    }
    this.subscriptions.set(playerId, {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });
    logger.debug({ playerId }, 'Push subscription registered');
  }

  /** Remove a player's push subscription. */
  unsubscribe(playerId: PlayerId): void {
    this.subscriptions.delete(playerId);
    logger.debug({ playerId }, 'Push subscription removed');
  }

  /** Send a "your turn" push notification to a player. */
  async notifyTurn(playerId: PlayerId, roomCode: string): Promise<void> {
    if (!this.enabled) return;
    const subscription = this.subscriptions.get(playerId);
    if (!subscription) return;

    const payload = JSON.stringify({
      title: "Bull 'Em",
      body: "It's your turn!",
      data: { roomCode },
    });

    try {
      await webpush.sendNotification(subscription, payload);
      logger.debug({ playerId, roomCode }, 'Push notification sent');
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 410 || statusCode === 404) {
        // Subscription expired or invalid — auto-remove
        this.subscriptions.delete(playerId);
        logger.info({ playerId, statusCode }, 'Push subscription expired — removed');
      } else {
        logger.warn({ playerId, err }, 'Failed to send push notification');
      }
    }
  }
}
