import webpush from 'web-push';
import type { PushSubscription } from 'web-push';
import type { PlayerId, PushSubscriptionJSON } from '@bull-em/shared';
import { query } from '../db/index.js';
import logger from '../logger.js';

// VAPID public key — must match the key in client/src/pushConfig.ts.
// Read from env so it can be configured per-environment; falls back to the
// hardcoded production key for convenience.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
  ?? 'BMMe4YdLfz9yXpst3eyO4JaTfdZDPdamLuYvR431cM_c77BDTpZYyeqE7K6PDzb8JyKTBMbGHh1FBNUugZpm7M8';

const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

interface PushSubscriptionRow {
  player_id: string;
  endpoint: string;
  key_p256dh: string;
  key_auth: string;
}

/**
 * Manages Web Push subscriptions and sends turn notifications.
 *
 * Subscriptions are persisted to PostgreSQL so they survive server restarts
 * and work across multiple server instances. An in-memory cache avoids a
 * database round-trip on every notification send.
 */
export class PushManager {
  /** In-memory cache — populated on startup, kept in sync with DB writes. */
  private cache = new Map<PlayerId, PushSubscription>();
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

  /**
   * Load all persisted subscriptions into the in-memory cache.
   * Called once at startup after the database is ready.
   */
  async loadFromDatabase(): Promise<void> {
    const result = await query<PushSubscriptionRow>(
      'SELECT player_id, endpoint, key_p256dh, key_auth FROM push_subscriptions',
    );
    if (!result) {
      logger.warn('Could not load push subscriptions — database unavailable');
      return;
    }
    for (const row of result.rows) {
      this.cache.set(row.player_id as PlayerId, {
        endpoint: row.endpoint,
        keys: { p256dh: row.key_p256dh, auth: row.key_auth },
      });
    }
    logger.info({ count: result.rows.length }, 'Push subscriptions loaded from database');
  }

  /** Register a push subscription for a player. */
  async subscribe(playerId: PlayerId, subscription: PushSubscriptionJSON): Promise<void> {
    if (!this.enabled) return;
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      logger.warn({ playerId }, 'Invalid push subscription — missing endpoint or keys');
      return;
    }

    const sub: PushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    };

    // Persist to database (upsert — player may re-subscribe with a new subscription)
    const dbResult = await query(
      `INSERT INTO push_subscriptions (player_id, endpoint, key_p256dh, key_auth, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (player_id) DO UPDATE
         SET endpoint = EXCLUDED.endpoint,
             key_p256dh = EXCLUDED.key_p256dh,
             key_auth = EXCLUDED.key_auth,
             updated_at = NOW()`,
      [playerId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
    );

    if (!dbResult) {
      logger.warn({ playerId }, 'Push subscription DB write failed — caching in memory only');
    }

    this.cache.set(playerId, sub);
    logger.debug({ playerId }, 'Push subscription registered');
  }

  /** Remove a player's push subscription. */
  async unsubscribe(playerId: PlayerId): Promise<void> {
    this.cache.delete(playerId);

    const dbResult = await query(
      'DELETE FROM push_subscriptions WHERE player_id = $1',
      [playerId],
    );
    if (!dbResult) {
      logger.warn({ playerId }, 'Push subscription DB delete failed');
    }

    logger.debug({ playerId }, 'Push subscription removed');
  }

  /** Send a "your turn" push notification to a player. */
  async notifyTurn(playerId: PlayerId, roomCode: string): Promise<void> {
    if (!this.enabled) return;
    const subscription = this.cache.get(playerId);
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
        // Subscription expired or invalid — remove from cache and DB
        this.cache.delete(playerId);
        void query('DELETE FROM push_subscriptions WHERE player_id = $1', [playerId]);
        logger.info({ playerId, statusCode }, 'Push subscription expired — removed');
      } else {
        logger.warn({ playerId, err }, 'Failed to send push notification');
      }
    }
  }
}
