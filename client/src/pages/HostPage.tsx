import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useGameContext } from '../context/GameContext.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import { useSound } from '../hooks/useSound.js';
import { MAX_PLAYERS_OPTIONS, ONLINE_TURN_TIMER_OPTIONS, maxPlayersForMaxCards, BotSpeed, JOKER_COUNT_OPTIONS, DEFAULT_JOKER_COUNT } from '@bull-em/shared';
import type { LastChanceMode, BotLevelCategory, BestOf, JokerCount } from '@bull-em/shared';
import { loadMatchSettings, saveMatchSettings } from '../components/VolumeControl.js';
import { friendlyError } from '../utils/friendlyErrors.js';

export function HostPage() {
  const navigate = useNavigate();
  const { isConnected, createRoom, updateSettings } = useGameContext();
  const { user } = useAuth();
  const { addToast } = useToast();
  const { play } = useSound();

  // Load saved settings from previous session, falling back to sensible defaults
  const saved = useMemo(() => loadMatchSettings('online'), []);
  const [maxCards, setMaxCards] = useState(saved?.maxCards ?? 5);
  const [maxPlayers, setMaxPlayers] = useState(saved?.maxPlayers ?? 6);
  const [turnTimer, setTurnTimer] = useState(() => {
    // Ensure saved timer is valid for online (must be in ONLINE_TURN_TIMER_OPTIONS)
    const t = saved?.turnTimer;
    return t != null && (ONLINE_TURN_TIMER_OPTIONS as readonly number[]).includes(t) ? t : 30;
  });
  const [allowSpectators, setAllowSpectators] = useState(saved?.allowSpectators ?? true);
  const [spectatorsCanSeeCards, setSpectatorsCanSeeCards] = useState(saved?.spectatorsCanSeeCards ?? false);
  const [botSpeed, setBotSpeed] = useState<BotSpeed>((saved?.botSpeed as BotSpeed) ?? BotSpeed.NORMAL);
  const [lastChanceMode, setLastChanceMode] = useState<LastChanceMode>((saved?.lastChanceMode as LastChanceMode) ?? 'classic');
  const [botLevelCategory, setBotLevelCategory] = useState<BotLevelCategory>((saved?.botLevelCategory as BotLevelCategory) ?? 'normal');
  const [jokerCount, setJokerCount] = useState<JokerCount>((saved?.jokerCount as JokerCount) ?? DEFAULT_JOKER_COUNT);
  const [showLcrInfo, setShowLcrInfo] = useState(false);
  const [loading, setLoading] = useState(false);

  const dynamicMaxPlayers = maxPlayersForMaxCards(maxCards, jokerCount);
  const validPlayerOptions = useMemo(
    () => MAX_PLAYERS_OPTIONS.filter(n => n <= dynamicMaxPlayers),
    [dynamicMaxPlayers],
  );

  const handleMaxCardsChange = (n: number) => {
    setMaxCards(n);
    const newMax = maxPlayersForMaxCards(n, jokerCount);
    if (maxPlayers > newMax) {
      // Find the largest valid option that fits
      const clamped = [...MAX_PLAYERS_OPTIONS].reverse().find(o => o <= newMax) ?? 2;
      setMaxPlayers(clamped);
    }
  };

  const handleCreate = async () => {
    if (!isConnected) return addToast('Not connected to server — please wait and try again');
    const playerName = sessionStorage.getItem('bull-em-player-name') || localStorage.getItem('bull-em-player-name');
    if (!playerName) return navigate('/');
    setLoading(true);
    try {
      const roomCode = await createRoom(playerName, user?.avatar);
      updateSettings({ maxCards, maxPlayers, turnTimer, allowSpectators, spectatorsCanSeeCards, botSpeed, lastChanceMode, botLevelCategory, jokerCount });
      saveMatchSettings({ maxCards, maxPlayers, turnTimer, allowSpectators, spectatorsCanSeeCards, botSpeed, lastChanceMode, botLevelCategory, jokerCount }, 'online');
      navigate(`/room/${roomCode}`, { replace: true });
    } catch (e) {
      addToast(friendlyError(e instanceof Error ? e.message : 'Failed to create room — check your connection'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="host-content space-y-4 max-w-md mx-auto pt-4">
        <h2 className="font-display text-2xl text-[var(--gold)] text-center host-title">Host Game</h2>

        <div className="host-actions">
          <button onClick={handleCreate} disabled={loading} className="w-full btn-gold py-3 text-lg">{loading ? 'Creating…' : 'Create Room'}</button>
          <button onClick={() => { play('uiBack'); navigate('/'); }} className="w-full btn-ghost py-2">Back</button>
        </div>

        <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold text-center host-settings-label">Optional Settings</p>

        <div className="host-left">
        <div className="glass px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">Max Cards</p>
          <div className="flex gap-1.5">{[1,2,3,4,5].map(n => (
            <button key={n} onClick={() => { play('uiSoft'); handleMaxCardsChange(n); }} className={`flex-1 px-2 py-2 text-sm rounded ${maxCards===n ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold' : 'glass text-[var(--gold-dim)]'}`}>{n}</button>
          ))}</div>
          <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
            Max {dynamicMaxPlayers} players with {maxCards} card{maxCards !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="glass px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">Max Players</p>
          <div className="flex gap-1.5 flex-wrap">{validPlayerOptions.map(n => (
            <button key={n} onClick={() => { play('uiSoft'); setMaxPlayers(n); }} className={`px-3 py-2 text-sm rounded ${maxPlayers===n ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold' : 'glass text-[var(--gold-dim)]'}`}>{n}</button>
          ))}</div>
        </div>

        <div className="glass px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">Turn Timer</p>
          <div className="flex gap-1.5">{ONLINE_TURN_TIMER_OPTIONS.map(n => (
            <button key={n} onClick={() => { play('uiSoft'); setTurnTimer(n); }} className={`flex-1 px-2 py-2 text-sm rounded ${turnTimer===n ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold' : 'glass text-[var(--gold-dim)]'}`}>{n}s</button>
          ))}</div>
        </div>
        <div className="glass px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">Bot Speed</p>
          <div className="flex gap-1.5">{([BotSpeed.SLOW, BotSpeed.NORMAL, BotSpeed.FAST] as const).map(speed => (
            <button key={speed} onClick={() => { play('uiSoft'); setBotSpeed(speed); }} className={`flex-1 px-2 py-2 text-sm rounded capitalize ${botSpeed===speed ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold' : 'glass text-[var(--gold-dim)]'}`}>{speed}</button>
          ))}</div>
        </div>

        <div className="glass px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">Bot Level</p>
          <div className="flex gap-1.5">{(['easy', 'normal', 'hard', 'mixed'] as const).map(cat => (
            <button key={cat} onClick={() => { play('uiSoft'); setBotLevelCategory(cat); }} className={`flex-1 px-2 py-2 text-sm rounded capitalize ${botLevelCategory===cat ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold' : 'glass text-[var(--gold-dim)]'}`}>{cat}</button>
          ))}</div>
          <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
            {botLevelCategory === 'easy' ? 'Levels 1-3 — beginner bots' :
             botLevelCategory === 'normal' ? 'Levels 4-6 — standard difficulty' :
             botLevelCategory === 'hard' ? 'Levels 7-9 — expert bots' :
             'Levels 1-9 — all skill levels'}
          </p>
        </div>

        <div className="glass px-4 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
              Allow &lsquo;True&rsquo; in LCR?
            </p>
            <button
              type="button"
              onClick={() => setShowLcrInfo(v => !v)}
              className="w-4 h-4 rounded-full border border-[var(--gold-dim)] text-[var(--gold-dim)] text-[9px] leading-none flex items-center justify-center hover:border-[var(--gold)] hover:text-[var(--gold)] transition-colors"
              aria-label="What is LCR?"
            >
              ?
            </button>
          </div>
          {showLcrInfo && (
            <div className="bg-black/40 rounded px-3 py-2 mb-2 text-[10px] text-[var(--gold-dim)] leading-relaxed">
              <strong className="text-[var(--gold)]">LCR</strong> = Last Chance Raise — when everyone calls bull, the last caller gets one chance to raise. This setting controls whether the next player can call &lsquo;True&rsquo; after that raise.
            </div>
          )}
          <div className="flex gap-1.5">{([['classic', 'Yes'], ['strict', 'No']] as const).map(([mode, label]) => (
            <button key={mode} onClick={() => { play('uiSoft'); setLastChanceMode(mode); }} className={`flex-1 px-2 py-2 text-sm rounded ${lastChanceMode===mode ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold' : 'glass text-[var(--gold-dim)]'}`}>{label}</button>
          ))}</div>
          <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
            {lastChanceMode === 'classic'
              ? 'After LCR, all players can bull, true, or raise'
              : 'After LCR, next player must bull or raise — no true option'}
          </p>
        </div>
        <div className="glass px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">Jokers (Wild)</p>
          <div className="flex gap-1.5">{JOKER_COUNT_OPTIONS.map(n => (
            <button key={n} onClick={() => { play('uiSoft'); setJokerCount(n); }} className={`flex-1 px-2 py-2 text-sm rounded ${jokerCount===n ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold' : 'glass text-[var(--gold-dim)]'}`}>{n}</button>
          ))}</div>
          <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
            {jokerCount === 0 ? 'Standard 52-card deck' : `${jokerCount} wild joker${jokerCount > 1 ? 's' : ''} — can substitute for any card`}
          </p>
        </div>
        </div>{/* end host-left */}

        <div className="host-right">
        <div className="glass px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">Spectators</p>
          <div className="space-y-2">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-[var(--gold-dim)]">Allow spectators</span>
              <button
                onClick={() => { play('uiSoft'); setAllowSpectators(v => !v); }}
                className={`w-11 h-6 rounded-full transition-colors relative border ${allowSpectators ? 'bg-[var(--gold)] border-[var(--gold)]' : 'bg-[rgba(255,255,255,0.1)] border-[rgba(255,255,255,0.3)]'}`}
              >
                <span className={`absolute left-0 top-[3px] w-[18px] h-[18px] rounded-full transition-transform bg-white shadow-sm ${allowSpectators ? 'translate-x-[23px]' : 'translate-x-[2px]'}`} />
              </button>
            </label>
            {allowSpectators && (
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-[var(--gold-dim)]">Spectators see cards</span>
                <button
                  onClick={() => { play('uiSoft'); setSpectatorsCanSeeCards(v => !v); }}
                  className={`w-11 h-6 rounded-full transition-colors relative border ${spectatorsCanSeeCards ? 'bg-[var(--gold)] border-[var(--gold)]' : 'bg-[rgba(255,255,255,0.1)] border-[rgba(255,255,255,0.3)]'}`}
                >
                  <span className={`absolute left-0 top-[3px] w-[18px] h-[18px] rounded-full transition-transform bg-white shadow-sm ${spectatorsCanSeeCards ? 'translate-x-[23px]' : 'translate-x-[2px]'}`} />
                </button>
              </label>
            )}
          </div>
        </div>

        </div>{/* end host-right */}
      </div>
    </Layout>
  );
}
