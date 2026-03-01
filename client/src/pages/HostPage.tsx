import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useGameContext } from '../context/GameContext.js';

export function HostPage() {
  const navigate = useNavigate();
  const { createRoom } = useGameContext();
  const [error, setError] = useState('');
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    const playerName = sessionStorage.getItem('bull-em-player-name');
    if (!playerName) {
      navigate('/');
      return;
    }
    attemptedRef.current = true;
    createRoom(playerName)
      .then((roomCode) => navigate(`/room/${roomCode}`, { replace: true }))
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to create room');
        setTimeout(() => navigate('/'), 3000);
      });
  }, [createRoom, navigate]);

  return (
    <Layout>
      <div className="flex items-center justify-center pt-16">
        <div className="text-center space-y-3 animate-fade-in">
          {error ? (
            <p className="text-[var(--danger)] text-sm">{error}</p>
          ) : (
            <>
              <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-[var(--gold-dim)]">Creating room&hellip;</p>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
