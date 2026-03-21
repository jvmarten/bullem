import { useState, useEffect, useCallback, memo } from 'react';
import { verifyFairness } from '@bull-em/shared';

interface Props {
  /** The revealed seed from the round result. */
  roundSeed?: string;
  /** The committed hash from the game state (sent before dealing). */
  roundSeedHash?: string | null;
}

/**
 * Small badge that verifies provably fair shuffle.
 * Shows verified/failed status with expandable details.
 */
export const ProvablyFairBadge = memo(function ProvablyFairBadge({ roundSeed, roundSeedHash }: Props) {
  const [verified, setVerified] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!roundSeed || !roundSeedHash) {
      setVerified(null);
      return;
    }
    let cancelled = false;
    verifyFairness(roundSeed, roundSeedHash).then(result => {
      if (!cancelled) setVerified(result);
    });
    return () => { cancelled = true; };
  }, [roundSeed, roundSeedHash]);

  const toggle = useCallback(() => setExpanded(v => !v), []);

  // Don't render if no seed data available
  if (!roundSeed || !roundSeedHash) return null;

  return (
    <div className="mt-2">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors mx-auto"
        type="button"
      >
        <span className={verified === true ? 'text-[var(--safe)]' : verified === false ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]'}>
          {verified === true ? '\u2713' : verified === false ? '\u2717' : '\u2022'}
        </span>
        <span>Provably Fair</span>
        <span className="text-[10px]">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>

      {expanded && (
        <div className="mt-2 p-3 rounded-lg glass text-xs space-y-2 text-left max-w-sm mx-auto">
          <div>
            <span className="text-[var(--text-secondary)]">Status: </span>
            <span className={verified === true ? 'text-[var(--safe)]' : verified === false ? 'text-[var(--danger)]' : ''}>
              {verified === true ? 'Verified' : verified === false ? 'Failed' : 'Checking...'}
            </span>
          </div>
          <div className="break-all">
            <span className="text-[var(--text-secondary)]">Seed Hash: </span>
            <code className="text-[10px]">{roundSeedHash.slice(0, 16)}...{roundSeedHash.slice(-8)}</code>
          </div>
          <div className="break-all">
            <span className="text-[var(--text-secondary)]">Seed: </span>
            <code className="text-[10px]">{roundSeed.slice(0, 16)}...{roundSeed.slice(-8)}</code>
          </div>
          <p className="text-[var(--text-secondary)] text-[10px] leading-tight">
            The seed hash was committed before cards were dealt. SHA-256(seed) = hash proves the shuffle was not manipulated.
          </p>
        </div>
      )}
    </div>
  );
});
