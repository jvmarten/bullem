import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useGameContext } from '../context/GameContext.js';

export function HomePage() {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { createRoom, joinRoom } = useGameContext();
  const navigate = useNavigate();

  const handleCreate = async () => {
    if (!name.trim()) return setError('Enter your name');
    setLoading(true);
    setError('');
    try {
      const code = await createRoom(name.trim());
      navigate(`/room/${code}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!name.trim()) return setError('Enter your name');
    if (!roomCode.trim()) return setError('Enter a room code');
    setLoading(true);
    setError('');
    try {
      await joinRoom(roomCode.trim().toUpperCase(), name.trim());
      navigate(`/room/${roomCode.trim().toUpperCase()}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to join room');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (mode === 'create') handleCreate();
      else if (mode === 'join') handleJoin();
    }
  };

  return (
    <Layout>
      <div className="flex flex-col items-center gap-8 pt-8">
        {/* Hero tagline */}
        <p className="text-[var(--gold-dim)] text-center text-sm tracking-wide">
          A multiplayer bluffing card game
        </p>

        {/* Decorative card fan */}
        <div className="flex justify-center -space-x-3 mb-2">
          {['\u2660', '\u2665', '\u2666', '\u2663'].map((s, i) => (
            <div
              key={s}
              className="playing-card w-10 h-14 flex items-center justify-center text-lg"
              style={{ transform: `rotate(${(i - 1.5) * 8}deg)`, zIndex: i }}
            >
              <span className={i === 1 || i === 2 ? 'suit-red' : 'suit-black'}>{s}</span>
            </div>
          ))}
        </div>

        {error && (
          <div className="w-full glass px-4 py-2.5 text-sm text-[var(--danger)] border-[var(--danger)] animate-shake">
            {error}
          </div>
        )}

        {mode === 'menu' && (
          <div className="flex flex-col gap-3 w-full animate-fade-in">
            <button onClick={() => setMode('create')} className="w-full btn-gold py-4 text-lg">
              Create Room
            </button>
            <button onClick={() => setMode('join')} className="w-full btn-ghost py-4 text-lg">
              Join Room
            </button>
          </div>
        )}

        {(mode === 'create' || mode === 'join') && (
          <div className="flex flex-col gap-3 w-full animate-fade-in" onKeyDown={handleKeyDown}>
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              autoFocus
              className="w-full input-felt"
            />

            {mode === 'join' && (
              <input
                type="text"
                placeholder="Room code"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                maxLength={4}
                className="w-full input-felt uppercase tracking-[0.3em] text-center text-xl font-bold"
              />
            )}

            <button
              onClick={mode === 'create' ? handleCreate : handleJoin}
              disabled={loading}
              className="w-full btn-gold py-3 text-lg"
            >
              {loading ? 'Connecting\u2026' : mode === 'create' ? 'Create' : 'Join'}
            </button>
            <button
              onClick={() => { setMode('menu'); setError(''); }}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
