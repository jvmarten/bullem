import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';

/**
 * Screen reader live region announcer. Provides a context-based API
 * for any component to announce game state changes to assistive tech.
 *
 * Uses an aria-live region that is visually hidden but read by screen
 * readers. Supports "polite" (queued) and "assertive" (interrupting)
 * announcements.
 */

interface AnnouncerContextValue {
  announce: (message: string, priority?: 'polite' | 'assertive') => void;
}

const AnnouncerContext = createContext<AnnouncerContextValue>({
  announce: () => {},
});

export function useAnnouncer(): AnnouncerContextValue {
  return useContext(AnnouncerContext);
}

export function ScreenReaderAnnouncerProvider({ children }: { children: ReactNode }) {
  const [politeMessage, setPoliteMessage] = useState('');
  const [assertiveMessage, setAssertiveMessage] = useState('');

  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    if (priority === 'assertive') {
      // Clear then set to ensure screen readers detect the change
      setAssertiveMessage('');
      requestAnimationFrame(() => setAssertiveMessage(message));
    } else {
      setPoliteMessage('');
      requestAnimationFrame(() => setPoliteMessage(message));
    }
  }, []);

  // Clear messages after they've been read
  useEffect(() => {
    if (!politeMessage) return;
    const timer = setTimeout(() => setPoliteMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [politeMessage]);

  useEffect(() => {
    if (!assertiveMessage) return;
    const timer = setTimeout(() => setAssertiveMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [assertiveMessage]);

  return (
    <AnnouncerContext.Provider value={{ announce }}>
      {children}
      {/* Visually hidden live regions for screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {politeMessage}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {assertiveMessage}
      </div>
    </AnnouncerContext.Provider>
  );
}
