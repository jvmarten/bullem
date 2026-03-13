# API Reference

## HTTP Endpoints

All HTTP routes are served from the Express backend on port 3001 (or `PORT` env var).

### Authentication (`/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/register` | No | Create account (email, password, username, displayName) |
| `POST` | `/auth/login` | No | Login (email + password). Sets HTTP-only JWT cookie |
| `POST` | `/auth/logout` | No | Clear auth cookie |
| `GET` | `/auth/me` | Required | Get current user profile |
| `PATCH` | `/auth/avatar` | Required | Update avatar template (`AvatarId`) |
| `PATCH` | `/auth/avatar-bg-color` | Required | Update avatar background color |
| `PATCH` | `/auth/username` | Required | Change username |
| `POST` | `/auth/upload-photo` | Required | Upload profile photo (multipart, Tigris S3) |
| `GET` | `/auth/games` | Required | Get authenticated user's game history |
| `POST` | `/auth/forgot-password` | No | Send password reset email |
| `POST` | `/auth/reset-password` | No | Reset password with token |

### OAuth (`/auth`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/google` | Redirect to Google OAuth consent screen |
| `GET` | `/auth/google/callback` | Google OAuth callback (sets JWT cookie, redirects to `/`) |
| `GET` | `/auth/apple` | Redirect to Apple Sign In page |
| `POST` | `/auth/apple/callback` | Apple OAuth callback (form POST, sets JWT cookie, redirects) |

### Player Stats & Ratings (`/api`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/stats/me` | Required | Current user's own stats |
| `GET` | `/api/stats/:userId` | No | Player stats (games, wins, accuracy) |
| `GET` | `/api/stats/:userId/games` | No | Player's game history (paginated) |
| `GET` | `/api/stats/:userId/advanced` | No | Advanced stats (heatmap, rivalries, trajectory) |
| `GET` | `/api/ratings/:userId` | No | Player's Elo and OpenSkill ratings |
| `GET` | `/api/users/:userId/profile` | No | Public profile (stats + display info) |
| `GET` | `/api/u/:username` | No | Look up user by username |

### Leaderboard (`/api/leaderboard`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/leaderboard/:mode` | No | Leaderboard for `heads_up` or `multiplayer`. Query: `?period=all_time|month|week&limit=50&offset=0&players=all|players|bots` |
| `GET` | `/api/leaderboard/:mode/nearby` | Required | Entries around the current user's rank |

### Replays (`/api/replays`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/replays` | No | List replays. Query: `?userId=...&limit=20&offset=0` |
| `GET` | `/api/replays/:gameId` | No | Get full replay data for a game |

### Deck Draw Minigame (`/api/deck-draw`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/deck-draw/stats` | Required | Player's Deck Draw lifetime stats |
| `POST` | `/api/deck-draw/draw` | Required | Execute a draw (wager amount in body) |
| `POST` | `/api/deck-draw/sync` | Required | Sync offline draws to server |

### Five Draw Minigame (`/api/five-draw`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/five-draw/result` | Required | Record a Five Draw game result |

### Friends (`/api/friends`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/friends` | Required | List friends with online status |
| `GET` | `/api/friends/count` | Required | Pending friend request count |

### Admin (`/admin`)

All admin routes require `requireAuth` + `requireAdmin` middleware.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/users` | List users (paginated, searchable) |
| `POST` | `/admin/set-role` | Change user role (user/admin) |
| `GET` | `/admin/rooms` | List active rooms with player details |
| `POST` | `/admin/kick` | Kick a player from a room |
| `POST` | `/admin/close-room` | Force-close a room |
| `POST` | `/admin/set-photo` | Set a user's profile photo URL |
| `GET` | `/admin/analytics` | Game balance analytics snapshot |
| `POST` | `/admin/analytics/refresh` | Refresh analytics snapshot |
| `POST` | `/admin/backfill-photos` | Backfill bot profile photos |

### Infrastructure

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check: `{ status, db, rooms, players }` |
| `GET` | `/metrics` | Prometheus metrics (text format) |

### Rate Limiting

- **Auth endpoints**: 10 requests per minute per IP
- **Socket events**: 15 events/sec per socket + 200ms cooldown between game actions
- Rate limiting uses Redis when available, falls back to in-memory with circuit breaker

---

## WebSocket Events

All real-time communication uses Socket.io with typed events defined in `shared/src/events.ts`.

### Client → Server Events

#### Room Management

| Event | Payload | Callback | Description |
|-------|---------|----------|-------------|
| `room:create` | `{ playerName, avatar? }` | `{ roomCode, reconnectToken }` or `{ error }` | Create a new room |
| `room:join` | `{ roomCode, playerName, playerId?, reconnectToken?, avatar? }` | `{ playerId, reconnectToken }` or `{ error }` | Join or reconnect to a room |
| `room:leave` | *(none)* | *(none)* | Leave current room |
| `room:list` | *(none)* | `{ rooms: RoomListing[] }` | List public rooms in lobby phase |
| `room:listLive` | *(none)* | `{ games: LiveGameListing[] }` | List games available for spectating |
| `room:spectate` | `{ roomCode }` | `{ ok: true }` or `{ error }` | Join as spectator |
| `room:updateSettings` | `{ settings: GameSettings }` | *(none)* | Update room settings (host only) |
| `room:setVisibility` | `{ isPublic }` | *(none)* | Toggle room public/private visibility |
| `room:addBot` | `{ botName? }` | `{ botId }` or `{ error }` | Add a bot to the room |
| `room:removeBot` | `{ botId }` | *(none)* | Remove a bot from the room |
| `room:kickPlayer` | `{ playerId }` | `{ ok: true }` or `{ error }` | Kick a player (host only) |
| `room:delete` | *(none)* | *(none)* | Delete the room (host only) |
| `room:watchRandom` | *(none)* | `{ roomCode }` or `{ error }` | Join a random spectatable game |

#### Game Actions

| Event | Payload | Description |
|-------|---------|-------------|
| `game:start` | *(none)* | Start the game (host only) |
| `game:call` | `{ hand: HandCall }` | Call or raise to a hand |
| `game:bull` | *(none)* | Call bull (disbelieve the hand) |
| `game:true` | *(none)* | Call true (affirm the hand exists) |
| `game:lastChanceRaise` | `{ hand: HandCall }` | Raise during last chance phase |
| `game:lastChancePass` | *(none)* | Pass during last chance (triggers resolution) |
| `game:continue` | *(none)* | Ready for next round (after round result) |
| `game:rematch` | *(none)* | Request rematch after game over |
| `game:reaction` | `{ emoji: GameEmoji }` | Send an emoji reaction |

#### Chat & Social

| Event | Payload | Callback | Description |
|-------|---------|----------|-------------|
| `chat:send` | `{ message }` | *(none)* | Send chat message |
| `friends:request` | `{ username }` | `{ ok }` or `{ error }` | Send friend request |
| `friends:respond` | `{ friendUserId, accept }` | `{ ok }` or `{ error }` | Accept/reject request |
| `friends:remove` | `{ friendUserId }` | `{ ok }` or `{ error }` | Remove friend |
| `friends:invite` | `{ friendUserId, roomCode }` | `{ ok }` or `{ error }` | Invite friend to room |
| `friends:list` | *(none)* | `{ friends, incomingCount }` or `{ error }` | Get friends list |

#### Matchmaking

| Event | Payload | Callback | Description |
|-------|---------|----------|-------------|
| `matchmaking:join` | `{ mode: RankedMode }` | `{ ok }` or `{ error }` | Join ranked queue |
| `matchmaking:leave` | *(none)* | `{ ok }` or `{ error }` | Leave ranked queue |

#### Push Notifications

| Event | Payload | Callback | Description |
|-------|---------|----------|-------------|
| `push:subscribe` | `PushSubscriptionJSON` | `{ ok }` or `{ error }` | Register push subscription |
| `push:unsubscribe` | *(none)* | `{ ok }` or `{ error }` | Remove push subscription |

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `room:state` | `RoomState` | Room state update (players, settings, phase) |
| `room:error` | `string` | Error message for room operations |
| `room:deleted` | *(none)* | Room was deleted |
| `room:kicked` | *(none)* | You were kicked from the room |
| `game:state` | `ClientGameState` | Per-player game state (only your cards included) |
| `game:roundResult` | `RoundResult` | Round resolution (called hand, penalties, revealed cards) |
| `game:newRound` | `ClientGameState` | New round started |
| `game:over` | `winnerId, GameStats, ratingChanges?` | Game ended |
| `game:replay` | `GameReplay` | Full game replay data |
| `game:rematchStarting` | *(none)* | Rematch is starting |
| `game:seriesSetResult` | `{ setWinnerId, seriesInfo }` | A set in a Bo3/Bo5 series ended |
| `game:countdown` | `{ seconds, label? }` | Pre-game or between-set countdown |
| `game:reaction` | `EmojiReaction` | Another player sent an emoji |
| `game:spectatorStats` | `GameStats` | Updated stats for spectators |
| `chat:message` | `ChatMessage` | Chat message received |
| `player:disconnected` | `playerId, disconnectDeadline` | A player disconnected |
| `player:reconnected` | `playerId` | A player reconnected |
| `server:playerCount` | `number` | Updated global online player count |
| `server:playerNames` | `string[]` | Online player names |
| `session:transferred` | *(none)* | Your session was transferred to a new connection |
| `matchmaking:queued` | `MatchmakingStatus` | Queue position update |
| `matchmaking:found` | `MatchmakingFound` | Match found — room code provided |
| `matchmaking:cancelled` | *(none)* | Matchmaking was cancelled |
| `friends:requestReceived` | `FriendEntry` | Incoming friend request |
| `friends:requestAccepted` | `FriendEntry` | Your request was accepted |
| `friends:statusChanged` | `{ userId, isOnline, currentRoomCode? }` | Friend's online status changed |
| `friends:invited` | `{ fromUserId, fromUsername, roomCode }` | Invited to a friend's room |
| `friends:roomCreated` | `{ userId, username, roomCode }` | Friend created/joined a room |
