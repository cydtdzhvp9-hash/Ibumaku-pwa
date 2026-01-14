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

const icon = (file: string) => `${import.meta.env.BASE_URL}navicons/${file}`;

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();
  const showDebugImport = (import.meta as any)?.env?.VITE_DEBUG_TOOLS === '1';

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
      <header className="topHeader">
        <h2 className="topTitle">指宿枕崎線 サイクルロゲイニング（MVP）</h2>

        <nav className="topNavIcons" aria-label="メニュー">
          <button type="button" className="navIconBtn" onClick={() => void go('/')} aria-label="ホーム">
            <img src={icon('home.png')} alt="ホーム" />
          </button>
          <button type="button" className="navIconBtn" onClick={() => void go('/terms')} aria-label="利用規約">
            <img src={icon('terms.png')} alt="利用規約" />
          </button>
          <button type="button" className="navIconBtn" onClick={() => void go('/notice-safety')} aria-label="安全に関する注意">
            <img src={icon('safety.png')} alt="安全注意" />
          </button>
          <button type="button" className="navIconBtn" onClick={() => void go('/privacy')} aria-label="プライバシーポリシー">
            <img src={icon('privacy.png')} alt="プライバシー" />
          </button>
          <button type="button" className="navIconBtn" onClick={() => void go('/support')} aria-label="サポート・ヘルプ">
            <img src={icon('support.png')} alt="サポート" />
          </button>
          <button type="button" className="navIconBtn" onClick={() => void go('/rules')} aria-label="ゲームルール">
            <img src={icon('rules.png')} alt="ルール" />
          </button>

          {showDebugImport ? (
            <button type="button" className="btn btnTiny" onClick={() => void go('/admin/import')}>CSV</button>
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
