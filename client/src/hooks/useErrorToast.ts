import { useEffect, useRef } from 'react';
import { useToast } from '../context/ToastContext.js';

/**
 * Bridges a context error string to the toast system.
 * Whenever `error` changes to a non-null value, a toast is shown.
 * Calls `clearError` after firing so the context state resets.
 */
export function useErrorToast(error: string | null, clearError: () => void): void {
  const { addToast } = useToast();
  const prevErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      addToast(error, 'error');
      clearError();
    }
    prevErrorRef.current = error;
  }, [error, addToast, clearError]);
}
