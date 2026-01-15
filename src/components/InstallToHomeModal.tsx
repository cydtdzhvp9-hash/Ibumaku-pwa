import React, { useMemo } from 'react';

type InstallGuideKind = 'ios' | 'android' | 'other';

export default function InstallToHomeModal({
  kind,
  onClose,
}: {
  kind: InstallGuideKind;
  onClose: () => void;
}) {
  const body = useMemo(() => {
    const intro = (
      <p className="installGuideIntro">
        本作品をブラウザでプレイいただく場合、画面遷移や再読み込みなどの操作等でエラーが表示されてプレイ不能となる場合がございますので、
        「ホーム画面へ追加」してプレイしてください。
      </p>
    );

    const note = (
      <p className="installGuideNote">
        補足：もし特定のアプリ（LINEやInstagramなど）の中のブラウザで開いている場合は、一度「Safari」や「Chrome」などのブラウザアプリで開き直してから上記の手順を行ってください。
      </p>
    );

    if (kind === 'ios') {
      return (
        <>
          {intro}
          <div className="installGuideSection">
            <div className="installGuideTitle">iPhone / iPad (Safari) の場合</div>
            <ol className="installGuideList">
              <li>画面下部（iPadは上部）にある 「共有アイコン」（四角から矢印が飛び出しているマーク）をタップします。</li>
              <li>メニューを下にスクロールし、「ホーム画面に追加」 を選択します。</li>
              <li>右上の 「追加」 をタップすると、ホーム画面にアイコンが表示されます。</li>
            </ol>
          </div>
          {note}
        </>
      );
    }

    if (kind === 'android') {
      return (
        <>
          {intro}
          <div className="installGuideSection">
            <div className="installGuideTitle">Android (Google Chrome) の場合</div>
            <ol className="installGuideList">
              <li>画面右上の 「三点リーダー」（縦に3つ並んだ点）をタップします。</li>
              <li>「ホーム画面に追加」 をタップします。</li>
              <li>確認画面が出るので、「追加」（または「自動的に追加」）をタップすると、ホーム画面にアイコンが表示されます。</li>
            </ol>
          </div>
          {note}
        </>
      );
    }

    return (
      <>
        {intro}
        <div className="installGuideSection">
          <div className="installGuideTitle">手順</div>
          <p className="installGuidePara">ご利用のブラウザのメニューから「ホーム画面に追加」を選択してください。</p>
        </div>
        {note}
      </>
    );
  }, [kind]);

  return (
    <div className="modalBackdrop" role="presentation">
      <div className="modalPanel" role="dialog" aria-modal="true" aria-label="ホーム画面に追加の案内">
        <div className="modalContent">{body}</div>
        <div className="modalActions">
          <button type="button" className="btn primary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
