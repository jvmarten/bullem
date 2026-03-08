import type { Server } from 'socket.io';
import { GamePhase, BotPlayer, SERIES_TRANSITION_DELAY_MS } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, RoundResult, PlayerId } from '@bull-em/shared';
import type { Room } from '../rooms/Room.js';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { BotManager } from '../game/BotManager.js';
import { broadcastGameState, broadcastNewRound, broadcastGameReplay, broadcastRoomState, sendTurnPushNotification } from './broadcast.js';
import { persistCompletedGame, computeRatingChanges } from './persistGame.js';
import { roundDurationSeconds } from '../metrics.js';
import { getCorrelatedLogger } from '../logger.js';
import { track } from '../analytics/track.js';
import { TurnAction } from '@bull-em/shared';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
const ROUND_CONTINUE_TIMEOUT_MS = 30_000;
const POST_RESOLVE_GRACE_MS = 5_000;

/** Track when each room's current round started, for duration metrics. */
const roundStartTimes = new Map<string, number>();

/** Record the start time of a new round for a room. Called from lobbyHandlers
 *  when a game starts and from startNextRound when a new round begins. */
export function recordRoundStart(roomCode: string): void {
  roundStartTimes.set(roomCode, Date.now());
}

/** Clean up the round start time entry for a room. Called when a room is
 *  deleted (stale cleanup, host delete) to prevent orphaned entries from
 *  games that never resolved a round. */
export function cleanupRoundStartTime(roomCode: string): void {
  roundStartTimes.delete(roomCode);
}

/** Observe the round duration for metrics and clean up the start time entry. */
function observeRoundDuration(roomCode: string): void {
  const startTime = roundStartTimes.get(roomCode);
  if (startTime !== undefined) {
    const durationSeconds = (Date.now() - startTime) / 1000;
    roundDurationSeconds.observe(durationSeconds);
    roundStartTimes.delete(roomCode);
  }
}

function startNextRound(io: TypedServer, room: Room, roomManager: RoomManager, botManager: BotManager): void {
  // Guard against double execution — the timeout and the last player's
  // "continue" can both fire startNextRound if they race.
  if (room.gamePhase !== GamePhase.ROUND_RESULT) return;
  room.cancelRoundContinueWindow();
  const nextResult = room.game!.startNextRound();
  if (nextResult.type === 'game_over') {
    handleSetOver(io, room, roomManager, botManager, nextResult.winnerId);
    return;
  }

  room.gamePhase = GamePhase.PLAYING;
  recordRoundStart(room.roomCode);
  // broadcastNewRound already sends per-player game state — no need to also
  // call broadcastGameState which would duplicate the same data to every socket.
  // Schedule the bot turn first so the human turn deadline is set before broadcast.
  botManager.scheduleBotTurn(room, io, POST_RESOLVE_GRACE_MS);
  broadcastNewRound(io, room);
  sendTurnPushNotification(io, room);
  roomManager.persistRoom(room);
}

/**
 * Handle a single game (set) ending. If the room has a series, check if
 * the series is decided or if we need to start the next set. If no series
 * (single game), finalize as game_over.
 */
export function handleSetOver(
  io: TypedServer,
  room: Room,
  roomManager: RoomManager,
  botManager: BotManager,
  setWinnerId: PlayerId,
): void {
  const series = room.seriesState;

  if (!series || series.bestOf <= 1) {
    // No series — normal game over
    finalizeGameOver(io, room, roomManager, setWinnerId);
    return;
  }

  // Record the set win
  series.wins[setWinnerId] = (series.wins[setWinnerId] ?? 0) + 1;
  const winsNeeded = Math.ceil(series.bestOf / 2);

  if (series.wins[setWinnerId]! >= winsNeeded) {
    // Series is decided — this player wins the match
    series.seriesWinnerId = setWinnerId;

    // Emit the series transition info before final game:over
    io.to(room.roomCode).emit('game:seriesSetResult', {
      setWinnerId,
      seriesInfo: {
        bestOf: series.bestOf,
        currentSet: series.currentSet,
        wins: { ...series.wins },
        winsNeeded,
        seriesWinnerId: setWinnerId,
      },
    });

    // Finalize the match — ratings update based on series winner, not set winner
    finalizeGameOver(io, room, roomManager, setWinnerId);
    return;
  }

  // Series continues — start next set after a brief transition
  series.currentSet++;

  // Emit the set result so clients can show the transition screen
  io.to(room.roomCode).emit('game:seriesSetResult', {
    setWinnerId,
    seriesInfo: {
      bestOf: series.bestOf,
      currentSet: series.currentSet,
      wins: { ...series.wins },
      winsNeeded,
      seriesWinnerId: null,
    },
  });

  // After transition delay, start the next set
  const log = getCorrelatedLogger();
  log.info({
    roomCode: room.roomCode,
    set: series.currentSet - 1,
    wins: series.wins,
  }, 'Series set completed — starting next set');

  botManager.clearTurnTimer(room.roomCode);

  setTimeout(() => {
    if (room.gamePhase === GamePhase.GAME_OVER || room.gamePhase === GamePhase.FINISHED) return;

    // Reset for next set — resetForRematch handles player reset
    room.resetForRematch();
    recordRoundStart(room.roomCode);
    BotPlayer.resetMemory(room.roomCode);
    botManager.scheduleBotTurn(room, io);
    broadcastRoomState(io, room);
    broadcastGameState(io, room);
    roomManager.persistRoom(room);
  }, SERIES_TRANSITION_DELAY_MS);

  roomManager.persistRoom(room);
}

/** Finalize a game/match as over — emit game:over, persist, update ratings. */
function finalizeGameOver(
  io: TypedServer,
  room: Room,
  roomManager: RoomManager,
  winnerId: PlayerId,
): void {
  room.gamePhase = GamePhase.GAME_OVER;
  broadcastGameReplay(io, room, winnerId);
  const stats = room.game!.getGameStats();
  // Compute rating changes for ranked games before emitting
  computeRatingChanges(room, winnerId).then(ratingChanges => {
    io.to(room.roomCode).emit('game:over', winnerId, stats, ratingChanges);
  }).catch(() => {
    io.to(room.roomCode).emit('game:over', winnerId, stats);
  });
  persistCompletedGame(room, winnerId);
  roomManager.persistRoom(room);
}

export function beginRoundResultPhase(
  io: TypedServer,
  room: Room,
  botManager: BotManager,
  result: RoundResult,
  roomManager: RoomManager,
): void {
  if (!room.game) return;

  const log = getCorrelatedLogger();
  observeRoundDuration(room.roomCode);
  log.info({ roomCode: room.roomCode }, 'Round resolved — entering result phase');

  room.game.setTurnDeadline(null);
  broadcastGameState(io, room);

  room.gamePhase = GamePhase.ROUND_RESULT;
  room.recordEliminations(result.eliminatedPlayerIds);
  io.to(room.roomCode).emit('game:roundResult', result);

  // Track bull:called for each player who called bull this round
  const roundNumber = room.game.getRoundSnapshots().length + 1;
  if (result.turnHistory) {
    for (const entry of result.turnHistory) {
      if (entry.action === TurnAction.BULL) {
        const wasCorrect = !result.handExists;
        track('bull:called', {
          playerId: entry.playerId,
          wasCorrect,
          roundNumber,
          currentHandType: result.calledHand.type,
          roomCode: room.roomCode,
          playerCount: room.playerCount,
        }, room.playerUserIds.get(entry.playerId) ?? null);
      }
    }
  }

  // Track bluff:attempted — the caller bluffed if the hand doesn't exist
  if (!result.handExists) {
    const wasCaught = result.penalizedPlayerIds.includes(result.callerId);
    track('bluff:attempted', {
      playerId: result.callerId,
      handType: result.calledHand.type,
      wasCaught,
      roomCode: room.roomCode,
      roundNumber,
      playerCount: room.playerCount,
    }, room.playerUserIds.get(result.callerId) ?? null);
  }

  // Update cross-round bot memory with round outcome, scoped to this room
  BotPlayer.updateMemory(result, room.roomCode);

  room.beginRoundContinueWindow(ROUND_CONTINUE_TIMEOUT_MS, () => {
    startNextRound(io, room, roomManager, botManager);
  });

  if (room.isRoundContinueComplete) {
    startNextRound(io, room, roomManager, botManager);
  }

  roomManager.persistRoom(room);
}

export function markContinueReady(
  io: TypedServer,
  room: Room,
  botManager: BotManager,
  playerId: PlayerId,
  roomManager: RoomManager,
): void {
  if (room.gamePhase !== GamePhase.ROUND_RESULT) return;
  // Idempotent: skip if already marked (prevents wasted isRoundContinueComplete checks)
  if (!room.markRoundContinueReady(playerId)) return;
  if (room.isRoundContinueComplete) {
    startNextRound(io, room, roomManager, botManager);
  }
}

/** Re-check whether all remaining active players have continued (e.g. after
 *  a player is eliminated mid-ROUND_RESULT). Starts the next round if so. */
export function checkRoundContinueComplete(
  io: TypedServer,
  room: Room,
  botManager: BotManager,
  roomManager: RoomManager,
): void {
  if (room.gamePhase !== GamePhase.ROUND_RESULT) return;
  if (room.isRoundContinueComplete) {
    startNextRound(io, room, roomManager, botManager);
  }
}
