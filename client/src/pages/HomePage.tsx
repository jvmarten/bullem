import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useGameContext } from '../context/GameContext.js';

export function HomePage() {
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');
  const [error, setError] = useState('');
  const { createRoom, joinRoom } = useGameContext();
  const navigate = useNavigate();

  const handleCreate = async () => {
    if (!name.trim()) return setError('Enter your name');
    try {
      const code = await createRoom(name.trim());
      navigate(`/room/${code}`);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleJoin = async () => {
    if (!name.trim()) return setError('Enter your name');
    if (!roomCode.trim()) return setError('Enter a room code');
    try {
      await joinRoom(roomCode.trim().toUpperCase(), name.trim());
      navigate(`/room/${roomCode.trim().toUpperCase()}`);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <Layout>
      <div className="flex flex-col items-center gap-6 pt-8">
        <p className="text-green-300 text-center text-sm">
          A multiplayer bluffing card game
        </p>

        {error && (
          <div className="w-full bg-red-900/50 border border-red-600 rounded-lg px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {mode === 'menu' && (
          <div className="flex flex-col gap-3 w-full">
            <button
              onClick={() => setMode('create')}
              className="w-full py-4 bg-yellow-500 hover:bg-yellow-400 text-gray-900 rounded-lg font-bold text-lg transition-colors"
            >
              Create Room
            </button>
            <button
              onClick={() => setMode('join')}
              className="w-full py-4 bg-green-600 hover:bg-green-500 rounded-lg font-bold text-lg transition-colors"
            >
              Join Room
            </button>
          </div>
        )}

        {(mode === 'create' || mode === 'join') && (
          <div className="flex flex-col gap-3 w-full">
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              className="w-full bg-green-800 border border-green-600 rounded-lg px-4 py-3 text-white placeholder-green-400 focus:outline-none focus:ring-2 focus:ring-yellow-500"
            />

            {mode === 'join' && (
              <input
                type="text"
                placeholder="Room code"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                maxLength={4}
                className="w-full bg-green-800 border border-green-600 rounded-lg px-4 py-3 text-white placeholder-green-400 uppercase tracking-widest text-center text-xl focus:outline-none focus:ring-2 focus:ring-yellow-500"
              />
            )}

            <button
              onClick={mode === 'create' ? handleCreate : handleJoin}
              className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-gray-900 rounded-lg font-bold text-lg transition-colors"
            >
              {mode === 'create' ? 'Create' : 'Join'}
            </button>
            <button
              onClick={() => { setMode('menu'); setError(''); }}
              className="text-green-400 hover:text-white text-sm transition-colors"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
