import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Outlet, Navigate } from 'react-router-dom';
import { GameProvider } from './context/GameContext.js';
import { GameStartBanner, ActiveGameRedirect } from './components/GameStartBanner.js';
import { AuthProvider } from './context/AuthContext.js';
import { ToastProvider } from './context/ToastContext.js';
import { FriendsProvider } from './context/FriendsContext.js';
import { ToastContainer } from './components/ToastContainer.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { ScreenReaderAnnouncerProvider } from './components/ScreenReaderAnnouncer.js';
import { ScrollToTop } from './components/ScrollToTop.js';
import { waitForAudioReady } from './hooks/soundEngine.js';
import { useViewportHeight } from './hooks/useViewportHeight.js';

// Eagerly loaded — the home page is the entry point most users hit first
import { HomePage } from './pages/HomePage.js';

// Lazy-loaded pages — deferred until the user navigates to them.
// This keeps the initial bundle small: lobby/game/results code (plus the
// entire LocalGameContext + GameEngine) is only fetched when needed.
// HostPage removed — game creation now goes directly to lobby via "Create Game"
const LobbyPage = lazy(() => import('./pages/LobbyPage.js').then(m => ({ default: m.LobbyPage })));
const GamePage = lazy(() => import('./pages/GamePage.js').then(m => ({ default: m.GamePage })));
const ResultsPage = lazy(() => import('./pages/ResultsPage.js').then(m => ({ default: m.ResultsPage })));
const HowToPlayPage = lazy(() => import('./pages/HowToPlayPage.js').then(m => ({ default: m.HowToPlayPage })));
const TutorialPage = lazy(() => import('./pages/TutorialPage.js').then(m => ({ default: m.TutorialPage })));

// Local game routes — the entire local game context + engine is only loaded
// when the user enters the local game flow.
const LocalLobbyPage = lazy(() => import('./pages/LocalLobbyPage.js').then(m => ({ default: m.LocalLobbyPage })));
const LocalGamePage = lazy(() => import('./pages/LocalGamePage.js').then(m => ({ default: m.LocalGamePage })));
const LocalResultsPage = lazy(() => import('./pages/LocalResultsPage.js').then(m => ({ default: m.LocalResultsPage })));
const LazyLocalGameProvider = lazy(() => import('./context/LocalGameContext.js').then(m => ({ default: m.LocalGameProvider })));
const ReplayPage = lazy(() => import('./pages/ReplayPage.js').then(m => ({ default: m.ReplayPage })));
const ReplaysPage = lazy(() => import('./pages/ReplaysPage.js').then(m => ({ default: m.ReplaysPage })));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage.js').then(m => ({ default: m.LeaderboardPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.js').then(m => ({ default: m.NotFoundPage })));
const DeckDrawPage = lazy(() => import('./pages/DeckDrawPage.js').then(m => ({ default: m.DeckDrawPage })));
const FiveDrawPage = lazy(() => import('./pages/FiveDrawPage.js').then(m => ({ default: m.FiveDrawPage })));

// Auth pages
const LoginPage = lazy(() => import('./pages/LoginPage.js').then(m => ({ default: m.LoginPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage.js').then(m => ({ default: m.ProfilePage })));
const PublicProfilePage = lazy(() => import('./pages/PublicProfilePage.js').then(m => ({ default: m.PublicProfilePage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage.js').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage.js').then(m => ({ default: m.ResetPasswordPage })));
const FriendsPage = lazy(() => import('./pages/FriendsPage.js').then(m => ({ default: m.FriendsPage })));


function OnlineLayout() {
  return (
    <GameProvider>
      <GameStartBanner />
      <ActiveGameRedirect />
      <Outlet />
    </GameProvider>
  );
}

/** Wraps a lazy-loaded route element with a Suspense boundary showing a named loading state. */
function SuspenseRoute({ label, children }: { label: string; children: React.ReactNode }) {
  return <Suspense fallback={<RouteLoadingFallback label={label} />}>{children}</Suspense>;
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
          <Route path="/login" element={<SuspenseRoute label="login"><LoginPage /></SuspenseRoute>} />
          <Route path="/profile" element={<SuspenseRoute label="profile"><ProfilePage /></SuspenseRoute>} />
          <Route path="/forgot-password" element={<SuspenseRoute label="page"><ForgotPasswordPage /></SuspenseRoute>} />
          <Route path="/reset-password" element={<SuspenseRoute label="page"><ResetPasswordPage /></SuspenseRoute>} />
          <Route path="/friends" element={<SuspenseRoute label="friends"><FriendsPage /></SuspenseRoute>} />
          <Route path="/replays" element={<SuspenseRoute label="replays"><ReplaysPage /></SuspenseRoute>} />
          <Route path="/leaderboard" element={<SuspenseRoute label="leaderboard"><LeaderboardPage /></SuspenseRoute>} />
          <Route path="/draw" element={<SuspenseRoute label="deck draw"><DeckDrawPage /></SuspenseRoute>} />
          <Route path="/deck-draw" element={<Navigate to="/draw" replace />} />
          <Route path="/five-draw" element={<SuspenseRoute label="5 draw"><FiveDrawPage /></SuspenseRoute>} />

          {/* Online multiplayer routes (HomePage needs GameProvider for player count) */}
          <Route element={<OnlineLayout />}>
            <Route path="/u/:username" element={<SuspenseRoute label="profile"><PublicProfilePage /></SuspenseRoute>} />
            <Route path="/" element={<HomePage />} />
            {/* /host removed — game creation goes directly to lobby via "Create Game" */}
            <Route path="/host" element={<Navigate to="/" replace />} />
            <Route path="/room/:roomCode" element={<SuspenseRoute label="lobby"><LobbyPage /></SuspenseRoute>} />
            <Route path="/game/:roomCode" element={<SuspenseRoute label="game"><GamePage /></SuspenseRoute>} />
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
