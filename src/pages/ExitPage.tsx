import React from 'react';
import { Link } from 'react-router-dom';

export default function ExitPage() {
  const tryClose = () => {
    try {
      window.close();
    } catch {
      // ignore
    }
  };

  return (
    <div className="card">
      <h3>終了</h3>
      <p className="hint">
        本アプリを利用するには「同意する」が必要です。ブラウザのタブを閉じる、またはPWAを終了してください。
      </p>
      <div className="actions">
        <button className="btn" onClick={tryClose}>閉じる</button>
        <Link className="btn" to="/notice-safety">戻る</Link>
      </div>
    </div>
  );
}
