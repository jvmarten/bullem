import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { GameProvider } from './context/GameContext.js';
import { AuthProvider } from './context/AuthContext.js';
import { ToastProvider } from './context/ToastContext.js';
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

// Auth pages
const LoginPage = lazy(() => import('./pages/LoginPage.js').then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/RegisterPage.js').then(m => ({ default: m.RegisterPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage.js').then(m => ({ default: m.ProfilePage })));
const PublicProfilePage = lazy(() => import('./pages/PublicProfilePage.js').then(m => ({ default: m.PublicProfilePage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage.js').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage.js').then(m => ({ default: m.ResetPasswordPage })));

function OnlineLayout() {
  return <GameProvider><Outlet /></GameProvider>;
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
function SplashScreen() {
  return (
    <div className="felt-bg text-[#e8e0d4] min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4 animate-fade-in">
        <h1
          className="text-4xl font-bold text-[var(--gold)]"
          style={{ fontFamily: "'Cormorant Garamond', serif" }}
        >
          Bull &apos;Em
        </h1>
        <div className="w-6 h-6 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-[var(--gold-dim)]">Loading assets&hellip;</p>
      </div>
    </div>
  );
}

export default function App() {
  const [assetsReady, setAssetsReady] = useState(false);

  useEffect(() => {
    // Wait for audio files to decode, but cap at 4s so a slow network
    // doesn't block the app indefinitely.
    const timeout = setTimeout(() => setAssetsReady(true), 4000);
    waitForAudioReady().then(() => {
      clearTimeout(timeout);
      setAssetsReady(true);
    });
    return () => clearTimeout(timeout);
  }, []);

  if (!assetsReady) return <SplashScreen />;
  return (
    <ErrorBoundary>
    <AuthProvider>
    <ToastProvider>
    <BrowserRouter>
      <ToastContainer />
      <ScrollToTop />
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/how-to-play" element={<HowToPlayPage />} />
          <Route path="/tutorial" element={<TutorialPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:userId" element={<PublicProfilePage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/replays" element={<ReplaysPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />

          {/* Online multiplayer routes (HomePage needs GameProvider for player count) */}
          <Route element={<OnlineLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/host" element={<HostPage />} />
            <Route path="/room/:roomCode" element={<LobbyPage />} />
            <Route path="/game/:roomCode" element={<GamePage />} />
            <Route path="/results/:roomCode" element={<ResultsPage />} />
            <Route path="/replay" element={<ReplayPage />} />
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
    </ToastProvider>
    </AuthProvider>
    </ErrorBoundary>
  );
}
