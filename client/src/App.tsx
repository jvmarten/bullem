import { BrowserRouter, Routes, Route, Outlet, Navigate } from 'react-router-dom';
import { GameProvider } from './context/GameContext.js';
import { LocalGameProvider } from './context/LocalGameContext.js';
import { HomePage } from './pages/HomePage.js';
import { LobbyPage } from './pages/LobbyPage.js';
import { GamePage } from './pages/GamePage.js';
import { ResultsPage } from './pages/ResultsPage.js';
import { LocalLobbyPage } from './pages/LocalLobbyPage.js';
import { LocalGamePage } from './pages/LocalGamePage.js';
import { LocalResultsPage } from './pages/LocalResultsPage.js';
import { HowToPlayPage } from './pages/HowToPlayPage.js';
import { HostPage } from './pages/HostPage.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';

function OnlineLayout() {
  return <GameProvider><Outlet /></GameProvider>;
}

function LocalLayout() {
  return <LocalGameProvider><Outlet /></LocalGameProvider>;
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/how-to-play" element={<HowToPlayPage />} />

        {/* Online multiplayer routes (HomePage needs GameProvider for player count) */}
        <Route element={<OnlineLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/host" element={<HostPage />} />
          <Route path="/room/:roomCode" element={<LobbyPage />} />
          <Route path="/game/:roomCode" element={<GamePage />} />
          <Route path="/results/:roomCode" element={<ResultsPage />} />
        </Route>

        {/* Local (offline) bot game routes */}
        <Route element={<LocalLayout />}>
          <Route path="/local" element={<LocalLobbyPage />} />
          <Route path="/local/game" element={<LocalGamePage />} />
          <Route path="/local/results" element={<LocalResultsPage />} />
        </Route>

        {/* Catch-all: redirect unknown URLs to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
