import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { GameProvider } from './context/GameContext.js';
import { GameStartBanner, ActiveGameRedirect } from './components/GameStartBanner.js';
import { AuthProvider } from './context/AuthContext.js';
import { ToastProvider } from './context/ToastContext.js';
import { FriendsProvider } from './context/FriendsContext.js';
import { ToastContainer } from './components/ToastContainer.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { ScrollToTop } from './components/ScrollToTop.js';
import { waitForAudioReady } from './hooks/soundEngine.js';

// Eagerly loaded — the home page is the entry point most users hit first
import { HomePage } from './pages/HomePage.js';

// Lazy-loaded pages — deferred until the user navigates to them.
// This keeps the initial bundle small: lobby/game/results code (plus the
// entire LocalGameContext + GameEngine) is only fetched when needed.
const HostPage = lazy(() => import('./pages/HostPage.js').then(m => ({ default: m.HostPage })));
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

function LocalLayout() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <LazyLocalGameProvider><Outlet /></LazyLocalGameProvider>
    </Suspense>
  );
}

function RouteLoadingFallback() {
  return (
    <div className="felt-bg text-[#e8e0d4] min-h-screen flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-[var(--gold-dim)]">Loading&hellip;</p>
      </div>
    </div>
  );
}

/** Splash screen shown while audio assets are loading on first visit. */
function SplashScreen({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="felt-bg text-[#e8e0d4] min-h-screen flex items-center justify-center">
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
    <BrowserRouter>
      <ToastContainer />
      <ScrollToTop />
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/rules" element={<HowToPlayPage />} />
          <Route path="/tutorial" element={<TutorialPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/replays" element={<ReplaysPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/draw" element={<DeckDrawPage />} />

          {/* Online multiplayer routes (HomePage needs GameProvider for player count) */}
          <Route element={<OnlineLayout />}>
            <Route path="/u/:username" element={<PublicProfilePage />} />
            <Route path="/" element={<HomePage />} />
            <Route path="/host" element={<HostPage />} />
            <Route path="/room/:roomCode" element={<LobbyPage />} />
            <Route path="/game/:roomCode" element={<GamePage />} />
            <Route path="/results/:roomCode" element={<ResultsPage />} />
            <Route path="/replay/:gameId?" element={<ReplayPage />} />
          </Route>

          {/* Local (offline) bot game routes */}
          <Route element={<LocalLayout />}>
            <Route path="/local" element={<LocalLobbyPage />} />
            <Route path="/local/game" element={<LocalGamePage />} />
            <Route path="/local/results" element={<LocalResultsPage />} />
            <Route path="/local/replay" element={<ReplayPage />} />
          </Route>

          {/* Catch-all: show 404 page for unknown URLs */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
    </FriendsProvider>
    </ToastProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
