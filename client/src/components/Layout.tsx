import type { ReactNode } from 'react';
import { useGameContext } from '../context/GameContext.js';

export function Layout({ children }: { children: ReactNode }) {
  const { isConnected } = useGameContext();

  return (
    <div className="min-h-screen bg-green-900 text-white">
      <header className="p-4 text-center border-b border-green-700 relative">
        <h1 className="text-2xl font-bold tracking-wide">Bull 'Em</h1>
        {!isConnected && (
          <div className="absolute top-1/2 right-4 -translate-y-1/2 flex items-center gap-1.5 text-xs text-yellow-400">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            Reconnecting...
          </div>
        )}
      </header>
      <main className="max-w-lg mx-auto p-4">{children}</main>
    </div>
  );
}
