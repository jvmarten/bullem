# Database Schema

PostgreSQL is optional. When `DATABASE_URL` is set, these tables are auto-created on server startup via `server/src/db/migrate.ts`. Without it, everything runs in-memory.

## Entity Relationship

```
users ──┬── game_players ──── games
        ├── ratings
        ├── rating_history
        ├── ranked_match_players ── ranked_matches ── games
        ├── friends
        ├── push_subscriptions
        ├── deck_draw_stats
        └── password_reset_tokens

games ──┬── game_players
        ├── rounds (replay snapshots)
        └── ranked_matches
```

## Tables

### `users`

Player accounts. Supports email+password and OAuth (Google, Apple).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `username` | TEXT (unique) | Unique handle, used for friend requests |
| `display_name` | TEXT | Shown in game |
| `email` | TEXT (unique, nullable) | Null for OAuth-only accounts |
| `password_hash` | TEXT (nullable) | bcrypt hash. Null for OAuth-only users |
| `auth_provider` | TEXT | `'email'`, `'google'`, `'apple'`, `'email+google'`, `'email+apple'` |
| `role` | TEXT | `'user'` or `'admin'` (default: `'user'`) |
| `avatar` | TEXT (nullable) | Avatar template ID (e.g., `'bull'`, `'ace'`, `'crown'`) |
| `avatar_bg_color` | TEXT (nullable) | Background color (e.g., `'amber'`, `'emerald'`) |
| `photo_url` | TEXT (nullable) | Custom profile photo URL (Tigris S3 CDN) |
| `is_bot` | BOOLEAN | True for bot accounts seeded via migration |
| `bot_profile` | TEXT (nullable) | Bot profile key (e.g., `'rock_8'`, `'viper_9'`) |
| `google_id` | TEXT (nullable) | Google OAuth subject ID |
| `apple_id` | TEXT (nullable) | Apple OAuth subject ID |
| `username_changed_at` | TIMESTAMPTZ (nullable) | Last username change (rate-limited) |
| `created_at` | TIMESTAMPTZ | Account creation time |
| `last_seen_at` | TIMESTAMPTZ | Last login/activity |

### `games`

One row per completed game.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `room_code` | TEXT | Room code where the game was played |
| `winner_id` | UUID (FK → users, nullable) | Null for guest games |
| `winner_name` | TEXT | Denormalized for guest support |
| `player_count` | INTEGER | Players at game start |
| `settings` | JSONB | `GameSettings` snapshot |
| `is_ranked` | BOOLEAN | Whether this was a ranked match |
| `started_at` | TIMESTAMPTZ | Game start time |
| `ended_at` | TIMESTAMPTZ | Game end time |
| `duration_seconds` | INTEGER (generated) | Computed from started_at/ended_at |

### `game_players`

Per-player stats for each completed game.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `game_id` | UUID (FK → games) | CASCADE on delete |
| `user_id` | UUID (FK → users, nullable) | Null for guests |
| `player_name` | TEXT | Display name at game time |
| `finish_position` | INTEGER | 1 = winner, higher = eliminated earlier |
| `final_card_count` | INTEGER | Cards when eliminated/game ended |
| `stats` | JSONB | `PlayerGameStats` (bulls, trues, bluffs, hand breakdown) |
| `rating_change` | DOUBLE PRECISION (nullable) | Elo/OpenSkill delta (null for unranked) |

### `rounds`

Round snapshots for the replay system.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `game_id` | UUID (FK → games) | CASCADE on delete |
| `round_number` | INTEGER | 1-based round index |
| `snapshot` | JSONB | `RoundSnapshot` (player cards, turn history, result) |

### `ratings`

Dual-track rating system: Elo for 1v1, OpenSkill for multiplayer.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `user_id` | UUID (FK → users) | CASCADE on delete |
| `mode` | TEXT | `'heads_up'` or `'multiplayer'` |
| `elo` | DOUBLE PRECISION | Elo rating (default 1200, used for heads_up) |
| `mu` | DOUBLE PRECISION | OpenSkill mean (default 25, used for multiplayer) |
| `sigma` | DOUBLE PRECISION | OpenSkill uncertainty (default 8.333) |
| `games_played` | INTEGER | Total ranked games in this mode |
| `peak_rating` | DOUBLE PRECISION | Highest rating achieved |
| `last_updated` | TIMESTAMPTZ | Last rating update |

Unique constraint: `(user_id, mode)` — one row per user per mode.

### `rating_history`

Per-game rating changes for timeline charts.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `user_id` | UUID (FK → users) | |
| `game_id` | UUID (FK → games) | |
| `mode` | TEXT | `'heads_up'` or `'multiplayer'` |
| `rating_before` | DOUBLE PRECISION | Rating before the game |
| `rating_after` | DOUBLE PRECISION | Rating after the game |
| `delta` | DOUBLE PRECISION | Change amount |
| `created_at` | TIMESTAMPTZ | When the game finished |

### `ranked_matches`

Detailed ranked match records for rating recalculation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `game_id` | UUID (FK → games, unique) | One ranked_match per game |
| `mode` | TEXT | `'heads_up'` or `'multiplayer'` |
| `player_count` | INTEGER | Total players (including bots) |
| `human_player_count` | INTEGER | Human players only |
| `from_matchmaking` | BOOLEAN | True if created by matchmaking queue |
| `settings` | JSONB | Game settings at match time |
| `started_at` | TIMESTAMPTZ | Match start |
| `ended_at` | TIMESTAMPTZ | Match end |

### `ranked_match_players`

Per-player data in ranked matches, with rating snapshots.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `match_id` | UUID (FK → ranked_matches) | CASCADE on delete |
| `user_id` | UUID | Player's user ID |
| `display_name` | TEXT | Name at match time |
| `finish_position` | INTEGER | Final placement |
| `is_bot` | BOOLEAN | Whether this player was a bot |
| `elo_before/after` | DOUBLE PRECISION (nullable) | Elo snapshots (heads_up) |
| `mu_before/after` | DOUBLE PRECISION (nullable) | OpenSkill mu snapshots (multiplayer) |
| `sigma_before/after` | DOUBLE PRECISION (nullable) | OpenSkill sigma snapshots |

### `friends`

Bidirectional friendship system. One row per relationship.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `user_id` | UUID (FK → users) | Initiator (sent request or applied block) |
| `friend_id` | UUID (FK → users) | Target |
| `status` | TEXT | `'pending'`, `'accepted'`, or `'blocked'` |
| `created_at` | TIMESTAMPTZ | When the relationship was created |
| `updated_at` | TIMESTAMPTZ | Last status change |

Queries must check both `user_id` and `friend_id` columns to find all friendships for a user.

### `push_subscriptions`

Web Push notification endpoints.

| Column | Type | Description |
|--------|------|-------------|
| `player_id` | TEXT (PK) | In-game player ID (not user ID — supports guests) |
| `endpoint` | TEXT | Push service URL |
| `key_p256dh` | TEXT | Encryption key |
| `key_auth` | TEXT | Auth secret |

### `deck_draw_stats`

Lifetime stats for the Deck Draw minigame.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID (PK, FK → users) | |
| `total_draws` | INTEGER | Total draws played |
| `total_wagered` | BIGINT | Total points wagered |
| `total_won` | BIGINT | Total points won |
| `biggest_win` | BIGINT | Largest single win |
| `best_hand_type` | INTEGER (nullable) | Best HandType drawn (0-9) |
| `balance` | BIGINT | Current point balance (starts at 1000) |
| `last_free_draw_at` | TIMESTAMPTZ (nullable) | Last daily free draw |
| `hand_counts` | JSONB | Count per hand type drawn |

### `password_reset_tokens`

Short-lived tokens for password reset flow.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `user_id` | UUID (FK → users) | CASCADE on delete |
| `token_hash` | TEXT (unique) | SHA-256 hash of the reset token |
| `expires_at` | TIMESTAMPTZ | Token expiry (1 hour) |
| `used_at` | TIMESTAMPTZ (nullable) | When the token was consumed |

### `analytics_balance_snapshot`

Game balance tracking for admin analytics.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Auto-generated |
| `snapshot_data` | JSONB | Aggregated balance metrics |
| `created_at` | TIMESTAMPTZ | When the snapshot was taken |

## Migrations

Migrations run automatically on startup. Each migration is idempotent (uses `IF NOT EXISTS`, `IF NOT EXISTS` for indexes, etc.). The migration runner tracks applied migrations in the `migrations` table.

Migration files: `server/src/db/migrations/001_*.sql` through `023_*.sql`.

To add a new migration: create `NNN_description.sql` in the migrations directory. It will run automatically on next server start.
