import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { GameProvider } from './context/GameContext.js';
import { HomePage } from './pages/HomePage.js';
import { LobbyPage } from './pages/LobbyPage.js';
import { GamePage } from './pages/GamePage.js';
import { ResultsPage } from './pages/ResultsPage.js';

export default function App() {
  return (
    <BrowserRouter>
      <GameProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/room/:roomCode" element={<LobbyPage />} />
          <Route path="/game/:roomCode" element={<GamePage />} />
          <Route path="/results/:roomCode" element={<ResultsPage />} />
        </Routes>
      </GameProvider>
    </BrowserRouter>
  );
}
