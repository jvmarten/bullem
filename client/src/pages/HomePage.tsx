import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';

export function HomePage() {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'menu' | 'local' | 'host' | 'join'>('menu');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handlePlayLocal = () => {
    if (!name.trim()) return setError('Enter your name');
    sessionStorage.setItem('bull-em-local-name', name.trim());
    navigate('/local');
  };

  const handleHost = () => {
    if (!name.trim()) return setError('Enter your name');
    sessionStorage.setItem('bull-em-player-name', name.trim());
    navigate('/host');
  };

  const handleJoin = () => {
    if (!name.trim()) return setError('Enter your name');
    if (!roomCode.trim()) return setError('Enter a room code');
    sessionStorage.setItem('bull-em-player-name', name.trim());
    navigate(`/room/${roomCode.trim().toUpperCase()}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (mode === 'local') handlePlayLocal();
      else if (mode === 'host') handleHost();
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
            <button onClick={() => setMode('local')} className="w-full btn-gold py-4 text-lg">
              Play vs Bots
            </button>
            <button onClick={() => setMode('host')} className="w-full btn-gold py-4 text-lg">
              Host Online Game
            </button>
            <button onClick={() => setMode('join')} className="w-full btn-ghost py-4 text-lg">
              Join Online Room
            </button>
            <Link
              to="/how-to-play"
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
            >
              How to Play
            </Link>
          </div>
        )}

        {mode === 'local' && (
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
            <button
              onClick={handlePlayLocal}
              className="w-full btn-gold py-3 text-lg"
            >
              Start Game
            </button>
            <button
              onClick={() => { setMode('menu'); setError(''); }}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
            >
              Back
            </button>
          </div>
        )}

        {mode === 'host' && (
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
            <button
              onClick={handleHost}
              className="w-full btn-gold py-3 text-lg"
            >
              Create Room
            </button>
            <button
              onClick={() => { setMode('menu'); setError(''); }}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
            >
              Back
            </button>
          </div>
        )}

        {mode === 'join' && (
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
            <input
              type="text"
              placeholder="Room code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={4}
              className="w-full input-felt uppercase tracking-[0.3em] text-center text-xl font-bold"
            />
            <button
              onClick={handleJoin}
              className="w-full btn-gold py-3 text-lg"
            >
              Join
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
