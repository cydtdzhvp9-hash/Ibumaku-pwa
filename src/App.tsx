import React, { useCallback } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ImportPage from './pages/ImportPage';
import SetupPage from './pages/SetupPage';
import PlayPage from './pages/PlayPage';
import ResultPage from './pages/ResultPage';
import RulesPage from './pages/RulesPage';
import AchievementsPage from './pages/AchievementsPage';

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();

  const go = useCallback(async (to: string) => {
    // When leaving Result page, allow it to do best-effort KPI submit once.
    if (loc.pathname === '/result' && typeof (window as any).__ibumaku_leave_result === 'function') {
      await (window as any).__ibumaku_leave_result(to);
      return;
    }
    nav(to);
  }, [loc.pathname, nav]);

  return (
    <div className="container">
      <header className="row" style={{alignItems:'center', justifyContent:'space-between'}}>
        <div style={{display:'flex', gap:12, alignItems:'center'}}>
          <h2 style={{margin:0}}>指宿枕崎線 サイクルロゲイニング（MVP）</h2>
        </div>
        <nav style={{display:'flex', gap:10, flexWrap:'wrap'}}>
          <button type="button" className="btn" onClick={() => void go('/')}>ホーム</button>
          <button type="button" className="btn" onClick={() => void go('/admin/import')}>CSV取込</button>
          <button type="button" className="btn" onClick={() => void go('/rules')}>ゲームルール</button>
        </nav>
      </header>
      <div style={{height:12}} />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin/import" element={<ImportPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/play" element={<PlayPage />} />
        <Route path="/result" element={<ResultPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/achievements" element={<AchievementsPage />} />
      </Routes>
    </div>
  );
}
