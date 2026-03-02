import { useContext, type ReactNode } from 'react';
import { GameContext } from '../context/GameContext.js';

export function Layout({ children, largeTitle }: { children: ReactNode; largeTitle?: boolean }) {
  const ctx = useContext(GameContext);
  const isConnected = ctx?.isConnected ?? true;

  return (
    <div className="felt-bg text-[#e8e0d4]">
      <header className={`px-4 text-center border-b border-[var(--felt-border)] relative ${largeTitle ? 'py-6' : 'py-1.5'}`}>
        <h1 className={`font-display font-bold tracking-wider text-[var(--gold)] title-glow ${largeTitle ? 'text-5xl' : 'text-xl'}`}>
          Bull &rsquo;Em
        </h1>
        {!isConnected && (
          <div className="absolute top-1/2 right-4 -translate-y-1/2 flex items-center gap-1.5 text-xs text-[var(--gold)]">
            <span className="dot-disconnected" />
            Reconnecting&hellip;
          </div>
        )}
      </header>
      <main className="max-w-lg mx-auto px-4 py-3">{children}</main>
    </div>
  );
}
