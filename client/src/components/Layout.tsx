import type { ReactNode } from 'react';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-green-900 text-white">
      <header className="p-4 text-center border-b border-green-700">
        <h1 className="text-2xl font-bold tracking-wide">Bull 'Em</h1>
      </header>
      <main className="max-w-lg mx-auto p-4">{children}</main>
    </div>
  );
}
