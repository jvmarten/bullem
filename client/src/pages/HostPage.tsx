import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useGameContext } from '../context/GameContext.js';
import { useToast } from '../context/ToastContext.js';
import { useSound } from '../hooks/useSound.js';
import { MAX_PLAYERS_OPTIONS, ONLINE_TURN_TIMER_OPTIONS, maxPlayersForMaxCards } from '@bull-em/shared';

export function HostPage() {
  const navigate = useNavigate();
  const { isConnected, createRoom, updateSettings } = useGameContext();
  const { addToast } = useToast();
  const { play } = useSound();
  const [maxCards, setMaxCards] = useState(5);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [turnTimer, setTurnTimer] = useState(30);
  const [allowSpectators, setAllowSpectators] = useState(false);
  const [spectatorsCanSeeCards, setSpectatorsCanSeeCards] = useState(false);
  const [loading, setLoading] = useState(false);

  const dynamicMaxPlayers = maxPlayersForMaxCards(maxCards);
  const validPlayerOptions = useMemo(
    () => MAX_PLAYERS_OPTIONS.filter(n => n <= dynamicMaxPlayers),
    [dynamicMaxPlayers],
  );

  const handleMaxCardsChange = (n: number) => {
    setMaxCards(n);
    const newMax = maxPlayersForMaxCards(n);
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
      const roomCode = await createRoom(playerName);
      updateSettings({ maxCards, maxPlayers, turnTimer, allowSpectators, spectatorsCanSeeCards });
      navigate(`/room/${roomCode}`, { replace: true });
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to create room — check your connection');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-4 max-w-md mx-auto pt-4">
        <h2 className="font-display text-2xl text-[var(--gold)] text-center">Host Game</h2>

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

        <button onClick={handleCreate} disabled={loading} className="w-full btn-gold py-3 text-lg">{loading ? 'Creating…' : 'Create Room'}</button>
        <button onClick={() => navigate('/')} className="w-full btn-ghost py-2">Back</button>
      </div>
    </Layout>
  );
}
