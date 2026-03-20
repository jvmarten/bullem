import { lazy, Suspense, useState, useEffect, useCallback, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Outlet, Navigate } from 'react-router-dom';
import { GameProvider } from './context/GameContext.js';
import { GameStartBanner, ActiveGameRedirect, ResumeMatchBanner } from './components/GameStartBanner.js';
import { AuthProvider } from './context/AuthContext.js';
import { ToastProvider } from './context/ToastContext.js';
import { FriendsProvider } from './context/FriendsContext.js';
import { ToastContainer } from './components/ToastContainer.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { GameErrorBoundary } from './components/GameErrorBoundary.js';
import { useGameContext } from './context/GameContext.js';
import { ScreenReaderAnnouncerProvider } from './components/ScreenReaderAnnouncer.js';
import { ScrollToTop } from './components/ScrollToTop.js';
import { waitForAudioReady } from './hooks/soundEngine.js';
import { useViewportHeight } from './hooks/useViewportHeight.js';

// Eagerly loaded — the home page is the entry point most users hit first
import { HomePage } from './pages/HomePage.js';

// Auto-reload once when a lazy chunk fails to load (e.g. stale hash after deploy).
// Uses sessionStorage to prevent infinite reload loops.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyWithRetry<T extends Record<string, any>>(
  factory: () => Promise<T>,
  pick: keyof T,
): ReturnType<typeof lazy> {
  return lazy(() =>
    factory().then(
      m => ({ default: m[pick] }),
      (err: unknown) => {
        const key = 'bull-em-chunk-retry';
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          window.location.reload();
        }
        throw err;
      },
    ),
  );
}

// Clear the chunk-retry flag on successful page load so future deploys can retry
sessionStorage.removeItem('bull-em-chunk-retry');

// Lazy-loaded pages — deferred until the user navigates to them.
// This keeps the initial bundle small: lobby/game/results code (plus the
// entire LocalGameContext + GameEngine) is only fetched when needed.
// HostPage removed — game creation now goes directly to lobby via "Create Game"
const LobbyPage = lazyWithRetry(() => import('./pages/LobbyPage.js'), 'LobbyPage');
const GamePage = lazyWithRetry(() => import('./pages/GamePage.js'), 'GamePage');
const ResultsPage = lazyWithRetry(() => import('./pages/ResultsPage.js'), 'ResultsPage');
const HowToPlayPage = lazyWithRetry(() => import('./pages/HowToPlayPage.js'), 'HowToPlayPage');
const TutorialPage = lazyWithRetry(() => import('./pages/TutorialPage.js'), 'TutorialPage');

// Local game routes — the entire local game context + engine is only loaded
// when the user enters the local game flow.
const LocalLobbyPage = lazyWithRetry(() => import('./pages/LocalLobbyPage.js'), 'LocalLobbyPage');
const LocalGamePage = lazyWithRetry(() => import('./pages/LocalGamePage.js'), 'LocalGamePage');
const LocalResultsPage = lazyWithRetry(() => import('./pages/LocalResultsPage.js'), 'LocalResultsPage');
const LazyLocalGameProvider = lazyWithRetry(() => import('./context/LocalGameContext.js'), 'LocalGameProvider');
const ReplayPage = lazyWithRetry(() => import('./pages/ReplayPage.js'), 'ReplayPage');
const ReplaysPage = lazyWithRetry(() => import('./pages/ReplaysPage.js'), 'ReplaysPage');
const LeaderboardPage = lazyWithRetry(() => import('./pages/LeaderboardPage.js'), 'LeaderboardPage');
const NotFoundPage = lazyWithRetry(() => import('./pages/NotFoundPage.js'), 'NotFoundPage');
const DeckDrawPage = lazyWithRetry(() => import('./pages/DeckDrawPage.js'), 'DeckDrawPage');
const FiveDrawPage = lazyWithRetry(() => import('./pages/FiveDrawPage.js'), 'FiveDrawPage');

// Auth pages
const LoginPage = lazyWithRetry(() => import('./pages/LoginPage.js'), 'LoginPage');
const ProfilePage = lazyWithRetry(() => import('./pages/ProfilePage.js'), 'ProfilePage');
const PublicProfilePage = lazyWithRetry(() => import('./pages/PublicProfilePage.js'), 'PublicProfilePage');
const ForgotPasswordPage = lazyWithRetry(() => import('./pages/ForgotPasswordPage.js'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyWithRetry(() => import('./pages/ResetPasswordPage.js'), 'ResetPasswordPage');
const FriendsPage = lazyWithRetry(() => import('./pages/FriendsPage.js'), 'FriendsPage');
const PrivacyPolicyPage = lazyWithRetry(() => import('./pages/PrivacyPolicyPage.js'), 'PrivacyPolicyPage');


function OnlineLayout() {
  return (
    <GameProvider>
      <GameStartBanner />
      <ResumeMatchBanner />
      <ActiveGameRedirect />
      <Outlet />
    </GameProvider>
  );
}

/** Wraps a lazy-loaded route element with a Suspense boundary showing a named loading state. */
function SuspenseRoute({ label, children }: { label: string; children: React.ReactNode }) {
  return <Suspense fallback={<RouteLoadingFallback label={label} />}>{children}</Suspense>;
}

/** Connects GameErrorBoundary's onRecover to GameContext so stale overlay
 *  state is cleared on error recovery, preventing repeated rendering crashes. */
function GamePageWithRecovery({ children }: { children: ReactNode }) {
  const { clearOverlayStateForRecovery } = useGameContext();
  const handleRecover = useCallback(() => {
    clearOverlayStateForRecovery();
  }, [clearOverlayStateForRecovery]);
  return <GameErrorBoundary onRecover={handleRecover}>{children}</GameErrorBoundary>;
}

function LocalLayout() {
  return (
    <Suspense fallback={<RouteLoadingFallback label="game" />}>
      <LazyLocalGameProvider><Outlet /></LazyLocalGameProvider>
    </Suspense>
  );
}

function RouteLoadingFallback({ label }: { label?: string } = {}) {
  return (
    <div className="felt-bg text-[#e8e0d4] items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-[var(--gold-dim)]">Loading {label ?? 'page'}&hellip;</p>
      </div>
    </div>
  );
}

/** Splash screen shown while audio assets are loading on first visit. */
function SplashScreen({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="felt-bg text-[#e8e0d4] items-center justify-center">
      <div className="text-center space-y-4 animate-fade-in">
        <img
          src="/bullem-text-transparent.png"
          alt="Bull 'Em"
          className="h-16 mx-auto"
          draggable={false}
        />
        {/* Progress bar */}
        <div className="w-48 h-1.5 rounded-full mx-auto overflow-hidden" style={{ background: 'var(--gold-glow)' }}>
          <div
            className="h-full rounded-full transition-[width] duration-200 ease-out"
            style={{ width: `${pct}%`, background: 'var(--gold)' }}
          />
        </div>
        <p className="text-sm text-[var(--gold-dim)]">Loading assets&hellip; {pct}%</p>
      </div>
    </div>
  );
}

export default function App() {
  useViewportHeight();
  const [assetsReady, setAssetsReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);

  useEffect(() => {
    // Wait for audio files to decode, but cap at 4s so a slow network
    // doesn't block the app indefinitely.
    const timeout = setTimeout(() => setAssetsReady(true), 4000);
    waitForAudioReady((fraction) => setLoadProgress(fraction)).then(() => {
      clearTimeout(timeout);
      setAssetsReady(true);
    });
    return () => clearTimeout(timeout);
  }, []);

  if (!assetsReady) return <SplashScreen progress={loadProgress} />;
  return (
    <ErrorBoundary>
    <AuthProvider>
    <ToastProvider>
    <FriendsProvider>
    <ScreenReaderAnnouncerProvider>
    <BrowserRouter>
      <ToastContainer />
      <ScrollToTop />
        <Routes>
          <Route path="/rules" element={<SuspenseRoute label="rules"><HowToPlayPage /></SuspenseRoute>} />
          <Route path="/tutorial" element={<SuspenseRoute label="tutorial"><TutorialPage /></SuspenseRoute>} />
          <Route path="/profile" element={<SuspenseRoute label="profile"><ProfilePage /></SuspenseRoute>} />
          <Route path="/forgot-password" element={<SuspenseRoute label="page"><ForgotPasswordPage /></SuspenseRoute>} />
          <Route path="/reset-password" element={<SuspenseRoute label="page"><ResetPasswordPage /></SuspenseRoute>} />
          <Route path="/friends" element={<SuspenseRoute label="friends"><FriendsPage /></SuspenseRoute>} />
          <Route path="/replays" element={<SuspenseRoute label="replays"><ReplaysPage /></SuspenseRoute>} />
          <Route path="/leaderboard" element={<SuspenseRoute label="leaderboard"><LeaderboardPage /></SuspenseRoute>} />
          <Route path="/draw" element={<SuspenseRoute label="deck draw"><DeckDrawPage /></SuspenseRoute>} />
          <Route path="/deck-draw" element={<Navigate to="/draw" replace />} />
          <Route path="/five-draw" element={<SuspenseRoute label="5 draw"><FiveDrawPage /></SuspenseRoute>} />
          <Route path="/privacy" element={<SuspenseRoute label="privacy policy"><PrivacyPolicyPage /></SuspenseRoute>} />

          {/* Online multiplayer routes (HomePage needs GameProvider for player count).
              Auth routes (/login, /forgot-password, /reset-password) are inside
              OnlineLayout so navigating from the home page doesn't unmount/remount
              the heavy GameProvider — that unmount caused a UI freeze on mobile. */}
          <Route element={<OnlineLayout />}>
            <Route path="/u/:username" element={<SuspenseRoute label="profile"><PublicProfilePage /></SuspenseRoute>} />
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<SuspenseRoute label="login"><LoginPage /></SuspenseRoute>} />
            {/* /host removed — game creation goes directly to lobby via "Create Game" */}
            <Route path="/host" element={<Navigate to="/" replace />} />
            <Route path="/room/:roomCode" element={<SuspenseRoute label="lobby"><LobbyPage /></SuspenseRoute>} />
            <Route path="/game/:roomCode" element={<SuspenseRoute label="game"><GamePageWithRecovery><GamePage /></GamePageWithRecovery></SuspenseRoute>} />
            <Route path="/results/:roomCode" element={<SuspenseRoute label="results"><ResultsPage /></SuspenseRoute>} />
            <Route path="/replay/:gameId?" element={<SuspenseRoute label="replay"><ReplayPage /></SuspenseRoute>} />
          </Route>

          {/* Local (offline) bot game routes */}
          <Route element={<LocalLayout />}>
            <Route path="/local" element={<SuspenseRoute label="lobby"><LocalLobbyPage /></SuspenseRoute>} />
            <Route path="/local/game" element={<SuspenseRoute label="game"><LocalGamePage /></SuspenseRoute>} />
            <Route path="/local/results" element={<SuspenseRoute label="results"><LocalResultsPage /></SuspenseRoute>} />
            <Route path="/local/replay" element={<SuspenseRoute label="replay"><ReplayPage /></SuspenseRoute>} />
          </Route>

          {/* Catch-all: show 404 page for unknown URLs */}
          <Route path="*" element={<SuspenseRoute label="page"><NotFoundPage /></SuspenseRoute>} />
        </Routes>
    </BrowserRouter>
    </ScreenReaderAnnouncerProvider>
    </FriendsProvider>
    </ToastProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
