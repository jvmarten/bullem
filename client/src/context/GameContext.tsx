import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react';
import type { ClientGameState, HandCall, RoomState, RoomListing, LiveGameListing, RoundResult, PlayerId, BotDifficulty, GameSettings, GameStats, GameReplay, EmojiReaction, GameEmoji, ChatMessage, RankedMode, MatchmakingStatus, MatchmakingFound, RatingChange, SeriesInfo, AvatarId } from '@bull-em/shared';
import { saveReplay } from '@bull-em/shared';
import { socket } from '../socket.js';
import { recordRecentPlayers } from '../utils/recentPlayers.js';

/** Presence state (online player count/names) is split into a separate context
 *  so that server-wide connect/disconnect events don't re-render game components.
 *  Only Layout (which shows the player count) subscribes to this context. */
export interface PresenceContextValue {
  onlinePlayerCount: number;
  onlinePlayerNames: string[];
}

export const PresenceContext = createContext<PresenceContextValue>({ onlinePlayerCount: 0, onlinePlayerNames: [] });

/** Map of playerId → Unix timestamp (ms) when their disconnect timer expires. */
export type DisconnectDeadlines = ReadonlyMap<string, number>;

export interface GameContextValue {
  roomState: RoomState | null;
  gameState: ClientGameState | null;
  roundResult: RoundResult | null;
  roundTransition: boolean;
  roundTransitionDeadline: number | null;
  winnerId: PlayerId | null;
  gameStats: GameStats | null;
  playerId: string | null;
  error: string | null;
  isConnected: boolean;
  /** True once the socket has connected at least once this session */
  hasConnected: boolean;
  /** Deadlines for disconnected players' reconnect windows. */
  disconnectDeadlines: DisconnectDeadlines;
  onlinePlayerCount: number;
  onlinePlayerNames: string[];
  createRoom: (playerName: string, avatar?: AvatarId | null) => Promise<string>;
  joinRoom: (roomCode: string, playerName: string, avatar?: AvatarId | null) => Promise<void>;
  leaveRoom: () => void;
  deleteRoom: () => void;
  listRooms: () => Promise<RoomListing[]>;
  listLiveGames: () => Promise<LiveGameListing[]>;
  spectateGame: (roomCode: string) => Promise<void>;
  watchRandomGame: () => Promise<string>;
  updateSettings: (settings: GameSettings) => void;
  setVisibility: (isPublic: boolean) => void;
  startGame: () => void;
  callHand: (hand: HandCall) => void;
  callBull: () => void;
  callTrue: () => void;
  lastChanceRaise: (hand: HandCall) => void;
  lastChancePass: () => void;
  clearError: () => void;
  clearRoundResult: () => void;
  addBot: (botName?: string) => Promise<string>;
  removeBot: (botId: string) => void;
  kickPlayer: (playerId: string) => Promise<void>;
  requestRematch: () => void;
  botDifficulty?: BotDifficulty;
  setBotDifficulty?: (d: BotDifficulty) => void;
  gameSettings?: GameSettings;
  setGameSettings?: (s: GameSettings) => void;
  isPaused?: boolean;
  togglePause?: () => void;
  /** Most recent game replay (populated at game over). */
  lastReplay: GameReplay | null;
  /** Active emoji reactions (auto-expire after 2s). */
  reactions: EmojiReaction[];
  /** Send an emoji reaction to all players in the room. */
  sendReaction: (emoji: GameEmoji) => void;
  /** Chat messages received in the current room. */
  chatMessages: ChatMessage[];
  /** Send a chat message to the room. */
  sendChatMessage: (message: string) => void;
  /** Current matchmaking queue status (null when not queued). */
  matchmakingStatus: MatchmakingStatus | null;
  /** Info about a found match (shown briefly before navigating to game). */
  matchmakingFound: MatchmakingFound | null;
  /** Join the matchmaking queue for a ranked mode. */
  joinMatchmaking: (mode: RankedMode) => Promise<void>;
  /** Leave the matchmaking queue. */
  leaveMatchmaking: () => Promise<void>;
  /** Clear the matchmaking found state (after navigation). */
  clearMatchmakingFound: () => void;
  /** Clear old game state when transitioning to a matched game.
   *  Unlike leaveRoom(), this does NOT emit room:leave (the server already
   *  assigned the socket to the new room) and does NOT clear session storage
   *  (already set to the new room's data by matchmaking:found handler). */
  resetForMatchedGame: () => void;
  /** Rating changes from the last completed ranked game (keyed by playerId). */
  ratingChanges: Record<PlayerId, RatingChange> | null;
  /** Room code to auto-navigate to after localStorage recovery (browser reopen). */
  pendingRejoinRoom: string | null;
  /** Clear the pending rejoin room (after navigation completes). */
  clearPendingRejoinRoom: () => void;
  /** Initial game stats sent to spectators on join (covers rounds before they joined). */
  spectatorInitialStats: GameStats | null;
  /** True when this socket's session was transferred to another device/tab. */
  sessionTransferred: boolean;
  /** Active countdown state (e.g. "3… 2… 1…" before game starts). */
  countdown: { secondsLeft: number; label?: string } | null;
  /** Clear stale overlay state locally (no server emit). Used by error boundary recovery. */
  clearOverlayStateForRecovery: () => void;
}

export const GameContext = createContext<GameContextValue | null>(null);

const PLAYER_ID_KEY = 'bull-em-player-id';
const PLAYER_NAME_KEY = 'bull-em-player-name';
const ROOM_CODE_KEY = 'bull-em-room-code';
const RECONNECT_TOKEN_KEY = 'bull-em-reconnect-token';
const SPECTATOR_ROOM_KEY = 'bull-em-spectator-room';
const SOCKET_CALLBACK_TIMEOUT_MS = 10_000;

// localStorage keys for surviving browser close/reopen. SessionStorage is
// cleared when the browser is fully closed, so we mirror critical reconnect
// data to localStorage. These are cleared on intentional leave/kick/delete.
const LS_ACTIVE_ROOM = 'bull-em-active-room';
const LS_ACTIVE_PLAYER_ID = 'bull-em-active-player-id';
const LS_ACTIVE_PLAYER_NAME = 'bull-em-active-player-name';
const LS_ACTIVE_RECONNECT_TOKEN = 'bull-em-active-reconnect-token';

/** Persist active game session to localStorage so reconnection survives browser close. */
function persistActiveSession(roomCode: string, playerId: string, playerName: string, reconnectToken: string): void {
  localStorage.setItem(LS_ACTIVE_ROOM, roomCode);
  localStorage.setItem(LS_ACTIVE_PLAYER_ID, playerId);
  localStorage.setItem(LS_ACTIVE_PLAYER_NAME, playerName);
  localStorage.setItem(LS_ACTIVE_RECONNECT_TOKEN, reconnectToken);
}

/** Clear localStorage active session data (intentional leave, kick, game over, etc.). */
function clearActiveSession(): void {
  localStorage.removeItem(LS_ACTIVE_ROOM);
  localStorage.removeItem(LS_ACTIVE_PLAYER_ID);
  localStorage.removeItem(LS_ACTIVE_PLAYER_NAME);
  localStorage.removeItem(LS_ACTIVE_RECONNECT_TOKEN);
}

/** Wrap a socket.emit callback promise with a timeout so it can't hang forever.
 *  The timeout is cleared once the inner promise settles, preventing leaked timers. */
function withTimeout<T>(promise: Promise<T>, ms = SOCKET_CALLBACK_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Request timed out')), ms);
  });
  const cleanup = () => clearTimeout(timer);
  // Clear the timer whether the inner promise resolves or rejects
  promise.then(cleanup, cleanup);
  return Promise.race([promise, timeoutPromise]);
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [roundTransition, setRoundTransition] = useState(false);
  const [roundTransitionDeadline, setRoundTransitionDeadline] = useState<number | null>(null);
  const [winnerId, setWinnerId] = useState<PlayerId | null>(null);
  const [gameStats, setGameStats] = useState<GameStats | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(() =>
    sessionStorage.getItem(PLAYER_ID_KEY),
  );
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [hasConnected, setHasConnected] = useState(socket.connected);
  const [onlinePlayerCount, setOnlinePlayerCount] = useState(0);
  const [onlinePlayerNames, setOnlinePlayerNames] = useState<string[]>([]);
  const [disconnectDeadlines, setDisconnectDeadlines] = useState<Map<string, number>>(new Map());
  const [lastReplay, setLastReplay] = useState<GameReplay | null>(null);
  const [reactions, setReactions] = useState<EmojiReaction[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [matchmakingStatus, setMatchmakingStatus] = useState<MatchmakingStatus | null>(null);
  const [matchmakingFound, setMatchmakingFound] = useState<MatchmakingFound | null>(null);
  const [pendingRejoinRoom, setPendingRejoinRoom] = useState<string | null>(null);
  const [ratingChanges, setRatingChanges] = useState<Record<PlayerId, RatingChange> | null>(null);
  const [spectatorInitialStats, setSpectatorInitialStats] = useState<GameStats | null>(null);
  const [sessionTransferred, setSessionTransferred] = useState(false);
  const [countdown, setCountdown] = useState<{ secondsLeft: number; label?: string } | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reactionTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const roundResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roundResultRef = useRef<RoundResult | null>(null);
  const roundResultReceivedAtRef = useRef<number>(0);
  const pendingGameStateRef = useRef<ClientGameState | null>(null);
  /** Tracks the latest game state for use in the game:over handler (which
   *  runs inside a static useEffect and can't read React state directly). */
  const gameStateRef = useRef<ClientGameState | null>(null);

  // Keep roundResultRef in sync with roundResult state
  useEffect(() => {
    roundResultRef.current = roundResult;
    if (roundResult) roundResultReceivedAtRef.current = Date.now();
  }, [roundResult]);

  // Keep gameStateRef in sync so the game:over handler can read player names
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  // Auto-clear errors after 5 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  // Auto-dismiss round result after 30 seconds
  useEffect(() => {
    if (!roundResult) return;
    roundResultTimerRef.current = setTimeout(() => {
      socket.emit('game:continue');
      setRoundResult(null);
      roundResultRef.current = null;
      // If the server already sent the next round state while the overlay was
      // showing, apply it immediately instead of showing the transition overlay.
      const pending = pendingGameStateRef.current;
      pendingGameStateRef.current = null;
      if (pending) {
        setGameState(pending);
        setRoundTransition(false);
        setRoundTransitionDeadline(null);
      } else {
        setRoundTransition(true);
        setRoundTransitionDeadline(roundResultReceivedAtRef.current + 30000);
      }
    }, 30000);
    return () => {
      if (roundResultTimerRef.current) clearTimeout(roundResultTimerRef.current);
    };
  }, [roundResult]);

  useEffect(() => {
    const handleNewGameState = (state: ClientGameState) => {
      if (roundResultRef.current !== null) {
        pendingGameStateRef.current = state;
      } else {
        setGameState(state);
        setRoundTransition(false);
        setRoundTransitionDeadline(null);
      }
    };

    const clearRoomState = () => {
      setRoomState(null);
      setGameState(null);
      setRoundResult(null);
      setRoundTransition(false);
      setWinnerId(null);
      setGameStats(null);
      setLastReplay(null);
      setDisconnectDeadlines(new Map());
      setChatMessages([]);
      sessionStorage.removeItem(PLAYER_ID_KEY);
      sessionStorage.removeItem(PLAYER_NAME_KEY);
      sessionStorage.removeItem(ROOM_CODE_KEY);
      sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
      sessionStorage.removeItem(SPECTATOR_ROOM_KEY);
      clearActiveSession();
    };

    // Flag to prevent double-rejoin: Socket.io fires both 'reconnect' (on
    // the Manager) and 'connect' (on the Socket) when reconnecting. The
    // reconnect handler sets this flag so the connect handler skips its own
    // rejoin attempt.
    let reconnectHandled = false;

    socket.on('connect', () => {
      setIsConnected(true);
      setHasConnected(true);

      // If the Socket.io reconnect handler already ran, skip — it already
      // emitted room:join.
      if (reconnectHandled) {
        reconnectHandled = false;
        return;
      }

      // On a fresh page load the socket has a brand-new ID and isn't joined
      // to any room on the server. This covers two scenarios:
      //   1. Browser fully closed and reopened — sessionStorage cleared,
      //      recover from localStorage.
      //   2. Browser "restored" the previous session (common on mobile and
      //      desktop restore-tabs) — sessionStorage still has data but the
      //      socket is new.
      // In both cases we need to re-emit room:join so the server maps this
      // socket back to the player.

      // Check if we were spectating
      const spectatorRoom = sessionStorage.getItem(SPECTATOR_ROOM_KEY);
      if (spectatorRoom) {
        socket.emit('room:spectate', { roomCode: spectatorRoom }, (response) => {
          if ('error' in response) {
            sessionStorage.removeItem(SPECTATOR_ROOM_KEY);
            setGameState(null);
          }
        });
        return;
      }

      // Try sessionStorage first (browser may have restored it), then
      // fall back to localStorage (browser fully closed).
      let roomCode = sessionStorage.getItem(ROOM_CODE_KEY);
      let storedPlayerId = sessionStorage.getItem(PLAYER_ID_KEY);
      let playerName = sessionStorage.getItem(PLAYER_NAME_KEY);
      let token = sessionStorage.getItem(RECONNECT_TOKEN_KEY);
      let fromLocalStorage = false;

      if (!roomCode || !storedPlayerId || !playerName || !token) {
        roomCode = localStorage.getItem(LS_ACTIVE_ROOM);
        storedPlayerId = localStorage.getItem(LS_ACTIVE_PLAYER_ID);
        playerName = localStorage.getItem(LS_ACTIVE_PLAYER_NAME);
        token = localStorage.getItem(LS_ACTIVE_RECONNECT_TOKEN);
        fromLocalStorage = true;
      }

      if (roomCode && storedPlayerId && playerName && token) {
        if (fromLocalStorage) {
          // Restore sessionStorage so the rest of the app works normally
          sessionStorage.setItem(ROOM_CODE_KEY, roomCode);
          sessionStorage.setItem(PLAYER_ID_KEY, storedPlayerId);
          sessionStorage.setItem(PLAYER_NAME_KEY, playerName);
          sessionStorage.setItem(RECONNECT_TOKEN_KEY, token);
        }

        clearStaleOverlayState();

        // Use retry-capable rejoin with extra handling for page-load recovery
        socket.emit('room:join', {
          roomCode,
          playerName,
          playerId: storedPlayerId,
          reconnectToken: token,
        }, (response) => {
          if ('error' in response) {
            // Retry once after 1s — the server may not have processed the
            // disconnect yet if the page reload happened quickly.
            setTimeout(() => {
              if (!socket.connected) return;
              socket.emit('room:join', {
                roomCode: roomCode!,
                playerName: playerName!,
                playerId: storedPlayerId!,
                reconnectToken: token!,
              }, (retryResponse) => {
                if ('error' in retryResponse) {
                  clearActiveSession();
                  sessionStorage.removeItem(PLAYER_ID_KEY);
                  sessionStorage.removeItem(PLAYER_NAME_KEY);
                  sessionStorage.removeItem(ROOM_CODE_KEY);
                  sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
                } else {
                  setPlayerId(retryResponse.playerId);
                  sessionStorage.setItem(RECONNECT_TOKEN_KEY, retryResponse.reconnectToken);
                  persistActiveSession(roomCode!, retryResponse.playerId, playerName!, retryResponse.reconnectToken);
                  setPendingRejoinRoom(roomCode!);
                }
              });
            }, 1000);
          } else {
            // Reconnection succeeded — update token and player ID
            setPlayerId(response.playerId);
            sessionStorage.setItem(RECONNECT_TOKEN_KEY, response.reconnectToken);
            persistActiveSession(roomCode!, response.playerId, playerName!, response.reconnectToken);
            // Signal auto-navigation to the game page
            setPendingRejoinRoom(roomCode!);
          }
        });
      }
    });
    socket.on('disconnect', () => setIsConnected(false));

    // Auto-rejoin the room after Socket.io reconnects. A brief disconnect
    // (app switch, network blip, page hidden on mobile) gives the socket a
    // new ID, so the server no longer knows which room it belongs to. Without
    // this, the client keeps stale state and receives no further game events.
    //
    // The 'reconnect' event fires on the Manager BEFORE the Socket's 'connect'
    // event. We set reconnectHandled so connect doesn't double-join.
    /** Whether we had a round result showing before the reconnection cleared it.
     *  Used to emit game:continue AFTER the room:join succeeds (the emit would be
     *  ignored if sent before the server maps the new socket). */
    let hadPendingRoundResult = false;

    /** Clear all stale overlay / transition state. Called on reconnection
     *  so the UI doesn't get stuck showing a stale reveal or transition overlay
     *  while the server sends fresh state. */
    const clearStaleOverlayState = () => {
      hadPendingRoundResult = roundResultRef.current !== null;
      setRoundResult(null);
      roundResultRef.current = null;
      pendingGameStateRef.current = null;
      setRoundTransition(false);
      setRoundTransitionDeadline(null);
      if (roundResultTimerRef.current) {
        clearTimeout(roundResultTimerRef.current);
        roundResultTimerRef.current = null;
      }
    };

    /** Attempt to rejoin a room, retrying up to maxRetries times on failure
     *  with exponential backoff. Permanent failures (room gone) clean up state. */
    const emitRejoin = (
      roomCode: string,
      playerName: string,
      playerId: string | undefined,
      reconnectToken: string | undefined,
      retriesLeft = 2,
    ) => {
      socket.emit('room:join', {
        roomCode,
        playerName,
        playerId,
        reconnectToken,
      }, (response) => {
        if ('error' in response) {
          // Retry on transient failures (timeout, brief server hiccup)
          if (retriesLeft > 0 && socket.connected) {
            const delay = (3 - retriesLeft) * 1000; // 1s, 2s
            setTimeout(() => {
              if (socket.connected) {
                emitRejoin(roomCode, playerName, playerId, reconnectToken, retriesLeft - 1);
              }
            }, delay);
            return;
          }
          // Permanent failure — room gone or token expired
          sessionStorage.removeItem(PLAYER_ID_KEY);
          sessionStorage.removeItem(PLAYER_NAME_KEY);
          sessionStorage.removeItem(ROOM_CODE_KEY);
          sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
          clearActiveSession();
          setRoomState(null);
          setGameState(null);
        } else {
          // Update rotated token in both storages
          sessionStorage.setItem(RECONNECT_TOKEN_KEY, response.reconnectToken);
          persistActiveSession(roomCode, response.playerId, playerName, response.reconnectToken);
          // If the player was viewing a round result before the disconnect,
          // tell the server they've moved on now that the new socket is mapped.
          if (hadPendingRoundResult) {
            socket.emit('game:continue');
            hadPendingRoundResult = false;
          }
        }
      });
    };

    const handleReconnect = () => {
      reconnectHandled = true;

      // Check if we were spectating — re-spectate instead of re-joining as a player
      const spectatorRoom = sessionStorage.getItem(SPECTATOR_ROOM_KEY);
      if (spectatorRoom) {
        socket.emit('room:spectate', { roomCode: spectatorRoom }, (response) => {
          if ('error' in response) {
            // Game ended or room gone — clean up spectator state
            sessionStorage.removeItem(SPECTATOR_ROOM_KEY);
            setGameState(null);
          }
        });
        return;
      }

      const storedRoomCode = sessionStorage.getItem(ROOM_CODE_KEY);
      const storedName = sessionStorage.getItem(PLAYER_NAME_KEY);
      const storedId = sessionStorage.getItem(PLAYER_ID_KEY);

      if (storedRoomCode && storedName) {
        clearStaleOverlayState();

        const storedToken = sessionStorage.getItem(RECONNECT_TOKEN_KEY) ?? undefined;
        emitRejoin(storedRoomCode, storedName, storedId ?? undefined, storedToken);
      }
    };
    socket.io.on('reconnect', handleReconnect);

    socket.on('room:state', (state) => {
      setRoomState(state);
      if (!sessionStorage.getItem(PLAYER_ID_KEY) && state.players.length === 1) {
        const id = state.players[0]!.id;
        setPlayerId(id);
        sessionStorage.setItem(PLAYER_ID_KEY, id);
        // Persist to localStorage for browser close recovery
        const name = sessionStorage.getItem(PLAYER_NAME_KEY) ?? '';
        const token = sessionStorage.getItem(RECONNECT_TOKEN_KEY) ?? '';
        if (name && token) {
          persistActiveSession(state.roomCode, id, name, token);
        }
      }
    });
    socket.on('game:state', handleNewGameState);
    socket.on('game:newRound', handleNewGameState);
    socket.on('game:roundResult', setRoundResult);
    socket.on('game:over', (wId, stats, rChanges) => {
      setWinnerId(wId);
      setGameStats(stats);
      setRatingChanges(rChanges ?? null);
      // Clear round result overlay so the navigation to results page fires
      // immediately. Without this, eliminated spectators who haven't clicked
      // "Continue" on the round result overlay would stay stuck on GamePage —
      // their game:continue is ignored by the server (eliminated), so no
      // pending game state clears the overlay for them.
      setRoundResult(null);
      roundResultRef.current = null;
      if (roundResultTimerRef.current) {
        clearTimeout(roundResultTimerRef.current);
        roundResultTimerRef.current = null;
      }
      // Discard any stale pending game state — the game is over, don't apply
      // a buffered mid-game state after navigating to results.
      pendingGameStateRef.current = null;
      // Game is over — clear active session so we don't try to rejoin on next browser open
      clearActiveSession();
      // Record other human players for the "Recent Players" list
      const gs = gameStateRef.current;
      const myName = sessionStorage.getItem(PLAYER_NAME_KEY);
      const roomCode = sessionStorage.getItem(ROOM_CODE_KEY);
      if (gs && myName && roomCode) {
        const humanNames = gs.players
          .filter(p => !p.isBot)
          .map(p => p.name);
        recordRecentPlayers(humanNames, myName, roomCode);
      }
    });
    socket.on('game:seriesSetResult', (_data: { setWinnerId: PlayerId; seriesInfo: SeriesInfo }) => {
      // The set result is consumed by the existing round result / game over flow.
      // The seriesInfo is embedded in the next game:state broadcast, so no extra
      // state is needed here. This handler exists to prevent unhandled-event warnings.
    });
    socket.on('game:countdown', (data: { seconds: number; label?: string }) => {
      // Clear any existing countdown timer
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      setCountdown({ secondsLeft: data.seconds, label: data.label });
      countdownTimerRef.current = setInterval(() => {
        setCountdown(prev => {
          if (!prev || prev.secondsLeft <= 1) {
            if (countdownTimerRef.current) {
              clearInterval(countdownTimerRef.current);
              countdownTimerRef.current = null;
            }
            return null;
          }
          return { ...prev, secondsLeft: prev.secondsLeft - 1 };
        });
      }, 1000);
    });
    socket.on('game:replay', (replay) => { setLastReplay(replay); saveReplay(replay); });
    socket.on('game:rematchStarting', () => {
      setWinnerId(null);
      setGameStats(null);
      setRatingChanges(null);
      setLastReplay(null);
      setRoundResult(null);
      setRoundTransition(false);
      setRoundTransitionDeadline(null);
      pendingGameStateRef.current = null;
      if (roundResultTimerRef.current) {
        clearTimeout(roundResultTimerRef.current);
        roundResultTimerRef.current = null;
      }
    });
    socket.on('room:error', setError);
    socket.on('room:deleted', clearRoomState);
    socket.on('room:kicked', clearRoomState);
    socket.on('player:disconnected', (disconnectedId: string, deadline: number) => {
      setDisconnectDeadlines(prev => {
        const next = new Map(prev);
        next.set(disconnectedId, deadline);
        return next;
      });
    });
    socket.on('player:reconnected', (reconnectedId: string) => {
      setDisconnectDeadlines(prev => {
        if (!prev.has(reconnectedId)) return prev;
        const next = new Map(prev);
        next.delete(reconnectedId);
        return next;
      });
    });
    socket.on('server:playerCount', setOnlinePlayerCount);
    socket.on('server:playerNames', setOnlinePlayerNames);
    socket.on('game:reaction', (reaction: EmojiReaction) => {
      setReactions(prev => [...prev, reaction]);
      // Auto-remove after 2 seconds; track timer for cleanup on unmount
      const timer = setTimeout(() => {
        reactionTimersRef.current.delete(timer);
        setReactions(prev => prev.filter(r => r.timestamp !== reaction.timestamp || r.playerId !== reaction.playerId));
      }, 2000);
      reactionTimersRef.current.add(timer);
    });
    socket.on('chat:message', (message: ChatMessage) => {
      setChatMessages(prev => {
        const next = [...prev, message];
        // Keep only the last 200 messages to prevent unbounded growth
        return next.length > 200 ? next.slice(-200) : next;
      });
    });
    socket.on('matchmaking:queued', (status: MatchmakingStatus) => {
      setMatchmakingStatus(status);
    });
    socket.on('matchmaking:found', (match: MatchmakingFound) => {
      setMatchmakingStatus(null);
      setMatchmakingFound(match);
      // Store session info so reconnection works for the auto-joined room
      sessionStorage.setItem(ROOM_CODE_KEY, match.roomCode);
      sessionStorage.setItem(PLAYER_ID_KEY, match.playerId);
      sessionStorage.setItem(RECONNECT_TOKEN_KEY, match.reconnectToken);
      // Ensure player name is stored for GamePage rejoin flow
      const playerName = sessionStorage.getItem(PLAYER_NAME_KEY) ?? localStorage.getItem('bull-em-player-name') ?? '';
      if (playerName && !sessionStorage.getItem(PLAYER_NAME_KEY)) {
        sessionStorage.setItem(PLAYER_NAME_KEY, playerName);
      }
      persistActiveSession(match.roomCode, match.playerId, playerName, match.reconnectToken);
      setPlayerId(match.playerId);
    });
    socket.on('matchmaking:cancelled', () => {
      setMatchmakingStatus(null);
    });
    socket.on('game:spectatorStats', (stats: GameStats) => {
      setSpectatorInitialStats(stats);
    });
    socket.on('session:transferred', () => {
      setSessionTransferred(true);
      // Clean up storage so this old tab/device doesn't try to auto-reconnect
      sessionStorage.removeItem(PLAYER_ID_KEY);
      sessionStorage.removeItem(PLAYER_NAME_KEY);
      sessionStorage.removeItem(ROOM_CODE_KEY);
      sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
      sessionStorage.removeItem(SPECTATOR_ROOM_KEY);
      clearActiveSession();
      // Disconnect this socket entirely — the new device owns the session
      socket.disconnect();
    });

    return () => {
      for (const timer of reactionTimersRef.current) clearTimeout(timer);
      reactionTimersRef.current.clear();
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      socket.off('connect');
      socket.off('disconnect');
      socket.off('room:state');
      socket.off('game:state');
      socket.off('game:newRound');
      socket.off('game:roundResult');
      socket.off('game:over');
      socket.off('game:seriesSetResult');
      socket.off('game:countdown');
      socket.off('game:replay');
      socket.off('game:rematchStarting');
      socket.off('room:error');
      socket.off('room:deleted');
      socket.off('room:kicked');
      socket.off('player:disconnected');
      socket.off('player:reconnected');
      socket.off('server:playerCount');
      socket.off('server:playerNames');
      socket.off('game:reaction');
      socket.off('chat:message');
      socket.off('matchmaking:queued');
      socket.off('matchmaking:found');
      socket.off('matchmaking:cancelled');
      socket.off('game:spectatorStats');
      socket.off('session:transferred');
      socket.io.off('reconnect', handleReconnect);
    };
  }, []);

  const createRoom = useCallback((playerName: string, avatar?: AvatarId | null): Promise<string> => {
    // Auto-leave previous room if still connected to one
    const existingRoom = sessionStorage.getItem(ROOM_CODE_KEY);
    if (existingRoom) {
      socket.emit('room:leave');
      setRoomState(null);
      setGameState(null);
      sessionStorage.removeItem(PLAYER_ID_KEY);
      sessionStorage.removeItem(ROOM_CODE_KEY);
      sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
      clearActiveSession();
    }
    return withTimeout(new Promise((resolve, reject) => {
      socket.emit('room:create', { playerName, avatar }, (response) => {
        if ('error' in response) return reject(new Error(response.error));
        sessionStorage.setItem(ROOM_CODE_KEY, response.roomCode);
        sessionStorage.setItem(PLAYER_NAME_KEY, playerName);
        sessionStorage.setItem(RECONNECT_TOKEN_KEY, response.reconnectToken);
        // playerId is set via room:state — persist after it's available
        resolve(response.roomCode);
      });
    }));
  }, []);

  const joinRoom = useCallback((roomCode: string, playerName: string, avatar?: AvatarId | null): Promise<void> => {
    // Auto-leave previous room if joining a different one
    const existingRoom = sessionStorage.getItem(ROOM_CODE_KEY);
    if (existingRoom && existingRoom !== roomCode) {
      socket.emit('room:leave');
      setRoomState(null);
      setGameState(null);
      sessionStorage.removeItem(PLAYER_ID_KEY);
      sessionStorage.removeItem(ROOM_CODE_KEY);
      sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
      clearActiveSession();
    }
    return withTimeout(new Promise((resolve, reject) => {
      // Check sessionStorage first, then fall back to localStorage (browser close scenario)
      const storedId = sessionStorage.getItem(PLAYER_ID_KEY) ?? localStorage.getItem(LS_ACTIVE_PLAYER_ID) ?? undefined;
      const storedToken = sessionStorage.getItem(RECONNECT_TOKEN_KEY) ?? localStorage.getItem(LS_ACTIVE_RECONNECT_TOKEN) ?? undefined;
      socket.emit('room:join', { roomCode, playerName, playerId: storedId, reconnectToken: storedToken, avatar }, (response) => {
        if ('error' in response) return reject(new Error(response.error));
        setPlayerId(response.playerId);
        sessionStorage.setItem(PLAYER_ID_KEY, response.playerId);
        sessionStorage.setItem(PLAYER_NAME_KEY, playerName);
        sessionStorage.setItem(ROOM_CODE_KEY, roomCode);
        sessionStorage.setItem(RECONNECT_TOKEN_KEY, response.reconnectToken);
        persistActiveSession(roomCode, response.playerId, playerName, response.reconnectToken);
        resolve();
      });
    }));
  }, []);

  const leaveRoom = useCallback(() => {
    socket.emit('room:leave');
    setRoomState(null);
    setGameState(null);
    setRoundResult(null);
    setRoundTransition(false);
    setWinnerId(null);
    setGameStats(null);
    setLastReplay(null);
    setChatMessages([]);
    sessionStorage.removeItem(PLAYER_ID_KEY);
    sessionStorage.removeItem(PLAYER_NAME_KEY);
    sessionStorage.removeItem(ROOM_CODE_KEY);
    sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
    sessionStorage.removeItem(SPECTATOR_ROOM_KEY);
    clearActiveSession();
  }, []);

  const deleteRoom = useCallback(() => {
    socket.emit('room:delete');
    setRoomState(null);
    setGameState(null);
    setRoundResult(null);
    setRoundTransition(false);
    setWinnerId(null);
    setGameStats(null);
    setLastReplay(null);
    setChatMessages([]);
    sessionStorage.removeItem(PLAYER_ID_KEY);
    sessionStorage.removeItem(PLAYER_NAME_KEY);
    sessionStorage.removeItem(ROOM_CODE_KEY);
    sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
    sessionStorage.removeItem(SPECTATOR_ROOM_KEY);
    clearActiveSession();
  }, []);

  const listRooms = useCallback((): Promise<RoomListing[]> => {
    return withTimeout(new Promise((resolve) => {
      socket.emit('room:list', (response) => resolve(response.rooms));
    }));
  }, []);

  const listLiveGames = useCallback((): Promise<LiveGameListing[]> => {
    return withTimeout(new Promise((resolve) => {
      socket.emit('room:listLive', (response) => resolve(response.games));
    }));
  }, []);

  const spectateGame = useCallback((roomCode: string): Promise<void> => {
    return withTimeout(new Promise((resolve, reject) => {
      socket.emit('room:spectate', { roomCode }, (response) => {
        if ('error' in response) return reject(new Error(response.error));
        sessionStorage.setItem(ROOM_CODE_KEY, roomCode);
        sessionStorage.setItem(SPECTATOR_ROOM_KEY, roomCode);
        resolve();
      });
    }));
  }, []);

  const watchRandomGame = useCallback((): Promise<string> => {
    return withTimeout(new Promise((resolve, reject) => {
      socket.emit('room:watchRandom', (response) => {
        if ('error' in response) return reject(new Error(response.error));
        sessionStorage.setItem(ROOM_CODE_KEY, response.roomCode);
        sessionStorage.setItem(SPECTATOR_ROOM_KEY, response.roomCode);
        resolve(response.roomCode);
      });
    }));
  }, []);

  const updateSettings = useCallback((settings: GameSettings) => {
    socket.emit('room:updateSettings', { settings });
  }, []);

  const setVisibility = useCallback((isPublic: boolean) => {
    socket.emit('room:setVisibility', { isPublic });
  }, []);

  const clearRoundResult = useCallback(() => {
    if (!roundResultRef.current) return;
    socket.emit('game:continue');
    setRoundResult(null);
    roundResultRef.current = null;
    if (roundResultTimerRef.current) {
      clearTimeout(roundResultTimerRef.current);
      roundResultTimerRef.current = null;
    }
    // If the server already sent the next round state while the overlay was
    // showing, apply it immediately instead of showing the transition overlay.
    const pending = pendingGameStateRef.current;
    pendingGameStateRef.current = null;
    if (pending) {
      setGameState(pending);
      setRoundTransition(false);
      setRoundTransitionDeadline(null);
    } else {
      setRoundTransition(true);
      setRoundTransitionDeadline(roundResultReceivedAtRef.current + 30000);
    }
  }, []);

  const addBot = useCallback((botName?: string): Promise<string> => {
    return withTimeout(new Promise((resolve, reject) => {
      socket.emit('room:addBot', { botName }, (response) => {
        if ('error' in response) return reject(new Error(response.error));
        resolve(response.botId);
      });
    }));
  }, []);

  const removeBot = useCallback((botId: string) => {
    socket.emit('room:removeBot', { botId });
  }, []);

  const kickPlayer = useCallback((targetPlayerId: string): Promise<void> => {
    return withTimeout(new Promise((resolve, reject) => {
      socket.emit('room:kickPlayer', { playerId: targetPlayerId }, (response) => {
        if ('error' in response) return reject(new Error(response.error));
        resolve();
      });
    }));
  }, []);

  const sendReaction = useCallback((emoji: GameEmoji) => socket.emit('game:reaction', { emoji }), []);
  const sendChatMessage = useCallback((message: string) => socket.emit('chat:send', { message }), []);

  const joinMatchmaking = useCallback((mode: RankedMode): Promise<void> => {
    return withTimeout(new Promise((resolve, reject) => {
      socket.emit('matchmaking:join', { mode }, (response) => {
        if ('error' in response) return reject(new Error(response.error));
        resolve();
      });
    }));
  }, []);

  const leaveMatchmaking = useCallback((): Promise<void> => {
    return withTimeout(new Promise((resolve, reject) => {
      socket.emit('matchmaking:leave', (response) => {
        if ('error' in response) return reject(new Error(response.error));
        setMatchmakingStatus(null);
        resolve();
      });
    }));
  }, []);

  const clearMatchmakingFound = useCallback(() => setMatchmakingFound(null), []);

  // Clear old game state for matchmaking transitions without emitting room:leave.
  // The server already assigned the socket to the new matched room, so emitting
  // room:leave would destroy the NEW room connection. Session storage already
  // holds the new room's data (set by the matchmaking:found handler).
  const resetForMatchedGame = useCallback(() => {
    setWinnerId(null);
    setGameStats(null);
    setRatingChanges(null);
    setRoomState(null);
    setGameState(null);
    setRoundResult(null);
    setRoundTransition(false);
    setRoundTransitionDeadline(null);
    setLastReplay(null);
    setChatMessages([]);
    pendingGameStateRef.current = null;
    if (roundResultTimerRef.current) {
      clearTimeout(roundResultTimerRef.current);
      roundResultTimerRef.current = null;
    }
  }, []);
  const clearPendingRejoinRoom = useCallback(() => setPendingRejoinRoom(null), []);

  /** Clear stale overlay state locally without notifying the server.
   *  Used by the error boundary's onRecover to prevent rendering crashes
   *  caused by inconsistent overlay state (roundResult/roundTransition). */
  const clearOverlayStateForRecovery = useCallback(() => {
    setRoundResult(null);
    roundResultRef.current = null;
    pendingGameStateRef.current = null;
    setRoundTransition(false);
    setRoundTransitionDeadline(null);
    if (roundResultTimerRef.current) {
      clearTimeout(roundResultTimerRef.current);
      roundResultTimerRef.current = null;
    }
  }, []);

  const startGame = useCallback(() => socket.emit('game:start'), []);
  const requestRematch = useCallback(() => socket.emit('game:rematch'), []);
  const callHand = useCallback((hand: HandCall) => socket.emit('game:call', { hand }), []);
  const callBull = useCallback(() => socket.emit('game:bull'), []);
  const callTrue = useCallback(() => socket.emit('game:true'), []);
  const lastChanceRaiseAction = useCallback((hand: HandCall) => socket.emit('game:lastChanceRaise', { hand }), []);
  const lastChancePassAction = useCallback(() => socket.emit('game:lastChancePass'), []);
  const clearErrorAction = useCallback(() => setError(null), []);

  // Presence context value is separate so online player count/name changes
  // (server-wide events on every connect/disconnect) don't re-render game
  // components. Only Layout subscribes to PresenceContext.
  const presenceValue: PresenceContextValue = useMemo(() => ({
    onlinePlayerCount,
    onlinePlayerNames,
  }), [onlinePlayerCount, onlinePlayerNames]);

  // onlinePlayerCount and onlinePlayerNames live in PresenceContext.
  // They are included here for interface compatibility but intentionally
  // excluded from the useMemo deps — no game component consumes them from
  // GameContext (Layout uses PresenceContext instead).
  const value: GameContextValue = useMemo(() => ({
    roomState,
    gameState,
    roundResult,
    roundTransition,
    roundTransitionDeadline,
    winnerId,
    gameStats,
    playerId,
    error,
    isConnected,
    hasConnected,
    disconnectDeadlines,
    onlinePlayerCount,
    onlinePlayerNames,
    createRoom,
    joinRoom,
    leaveRoom,
    deleteRoom,
    listRooms,
    listLiveGames,
    spectateGame,
    watchRandomGame,
    updateSettings,
    setVisibility,
    startGame,
    callHand,
    callBull,
    callTrue,
    lastChanceRaise: lastChanceRaiseAction,
    lastChancePass: lastChancePassAction,
    clearError: clearErrorAction,
    clearRoundResult,
    addBot,
    removeBot,
    kickPlayer,
    requestRematch,
    lastReplay,
    reactions,
    sendReaction,
    chatMessages,
    sendChatMessage,
    matchmakingStatus,
    matchmakingFound,
    joinMatchmaking,
    leaveMatchmaking,
    clearMatchmakingFound,
    resetForMatchedGame,
    ratingChanges,
    pendingRejoinRoom,
    clearPendingRejoinRoom,
    spectatorInitialStats,
    sessionTransferred,
    countdown,
    clearOverlayStateForRecovery,
  }), [
    roomState, gameState, roundResult, roundTransition, roundTransitionDeadline,
    winnerId, gameStats, playerId, error, isConnected, hasConnected, disconnectDeadlines, sessionTransferred, countdown,
    lastReplay, reactions, chatMessages,
    matchmakingStatus, matchmakingFound, ratingChanges, pendingRejoinRoom, spectatorInitialStats,
    createRoom, joinRoom, leaveRoom, deleteRoom, listRooms, listLiveGames,
    spectateGame, watchRandomGame, updateSettings, setVisibility, startGame, callHand, callBull, callTrue,
    lastChanceRaiseAction, lastChancePassAction, clearErrorAction, clearRoundResult,
    addBot, removeBot, kickPlayer, requestRematch, sendReaction, sendChatMessage,
    joinMatchmaking, leaveMatchmaking, clearMatchmakingFound, resetForMatchedGame, clearPendingRejoinRoom,
    clearOverlayStateForRecovery,
  ]);

  return (
    <PresenceContext.Provider value={presenceValue}>
      <GameContext.Provider value={value}>{children}</GameContext.Provider>
    </PresenceContext.Provider>
  );
}

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameContext must be used within GameProvider');
  return ctx;
}
