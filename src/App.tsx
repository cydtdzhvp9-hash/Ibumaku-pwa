import React, { useCallback } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ImportPage from './pages/ImportPage';
import SetupPage from './pages/SetupPage';
import PlayPage from './pages/PlayPage';
import ResultPage from './pages/ResultPage';
import RulesPage from './pages/RulesPage';
import AchievementsPage from './pages/AchievementsPage';
import NoticeSafetyPage from './pages/NoticeSafetyPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import SupportPage from './pages/SupportPage';
import ExitPage from './pages/ExitPage';
import { hasSafetyConsent, hasTermsConsent, isConsentBlocked } from './logic/consent';

function ConsentGuard({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const path = loc.pathname;

  // Allow the user to view the consent pages and exit page without any guards.
  const allowList = ['/notice-safety', '/terms', '/privacy', '/support', '/rules', '/exit'];
  if (allowList.includes(path)) return <>{children}</>;

  // If blocked, always send to exit.
  if (isConsentBlocked()) return <Navigate to="/exit" replace />;

  // Force safety -> terms -> app.
  if (!hasSafetyConsent()) return <Navigate to="/notice-safety" replace />;
  if (!hasTermsConsent()) return <Navigate to="/terms" replace />;
  return <>{children}</>;
}

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();
  const showDebugImport = (import.meta as any)?.env?.VITE_DEBUG_TOOLS === '1';

  const go = useCallback((to: string) => {
    // When leaving Result page, allow it to do best-effort KPI submit once.
    if (loc.pathname === '/result' && typeof (window as any).__ibumaku_leave_result === 'function') {
      (window as any).__ibumaku_leave_result(to);
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
          <button type="button" className="btn" onClick={() => void go('/terms')}>規約</button>
          <button type="button" className="btn" onClick={() => void go('/notice-safety')}>安全</button>
          <button type="button" className="btn" onClick={() => void go('/privacy')}>プラポリ</button>
          <button type="button" className="btn" onClick={() => void go('/support')}>サポート</button>
          <button type="button" className="btn" onClick={() => void go('/rules')}>ルール</button>
          {showDebugImport ? (
            <button type="button" className="btn" onClick={() => void go('/admin/import')}>CSV</button>
          ) : null}
        </nav>
      </header>
      <div style={{height:12}} />
      <ConsentGuard>
        <Routes>
          <Route path="/notice-safety" element={<NoticeSafetyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/exit" element={<ExitPage />} />

          <Route path="/" element={<HomePage />} />
          <Route path="/admin/import" element={<ImportPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/play" element={<PlayPage />} />
          <Route path="/result" element={<ResultPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/achievements" element={<AchievementsPage />} />
        </Routes>
      </ConsentGuard>
    </div>
  );
}
