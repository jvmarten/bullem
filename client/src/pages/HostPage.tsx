import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useGameContext } from '../context/GameContext.js';
import { MAX_PLAYERS_OPTIONS, ONLINE_TURN_TIMER_OPTIONS } from '@bull-em/shared';

export function HostPage() {
  const navigate = useNavigate();
  const { createRoom, updateSettings } = useGameContext();
  const [maxCards, setMaxCards] = useState(5);
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [turnTimer, setTurnTimer] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    const playerName = sessionStorage.getItem('bull-em-player-name') || localStorage.getItem('bull-em-player-name');
    if (!playerName) return navigate('/');
    setLoading(true);
    setError('');
    try {
      const roomCode = await createRoom(playerName);
      updateSettings({ maxCards, maxPlayers, turnTimer });
      navigate(`/room/${roomCode}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-4 max-w-md mx-auto pt-4">
        <h2 className="font-display text-2xl text-[var(--gold)] text-center">Host Game</h2>
        {error && <div className="glass px-4 py-2 text-sm text-[var(--danger)] border-[var(--danger)]">{error}</div>}

        <div className="glass px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">Max Cards</p>
          <div className="flex gap-1.5">{[1,2,3,4,5].map(n => (
            <button key={n} onClick={() => setMaxCards(n)} className={`flex-1 px-2 py-2 text-sm rounded ${maxCards===n ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold' : 'glass text-[var(--gold-dim)]'}`}>{n}</button>
          ))}</div>
        </div>

        <div className="glass px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">Max Players</p>
          <div className="flex gap-1.5 flex-wrap">{MAX_PLAYERS_OPTIONS.map(n => (
            <button key={n} onClick={() => setMaxPlayers(n)} className={`px-3 py-2 text-sm rounded ${maxPlayers===n ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold' : 'glass text-[var(--gold-dim)]'}`}>{n}</button>
          ))}</div>
        </div>

        <div className="glass px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">Turn Timer</p>
          <div className="flex gap-1.5">{ONLINE_TURN_TIMER_OPTIONS.map(n => (
            <button key={n} onClick={() => setTurnTimer(n)} className={`flex-1 px-2 py-2 text-sm rounded ${turnTimer===n ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold' : 'glass text-[var(--gold-dim)]'}`}>{n}s</button>
          ))}</div>
        </div>

        <button onClick={handleCreate} disabled={loading} className="w-full btn-gold py-3 text-lg">{loading ? 'Creating…' : 'Create Room'}</button>
        <button onClick={() => navigate('/')} className="w-full btn-ghost py-2">Back</button>
      </div>
    </Layout>
  );
}
