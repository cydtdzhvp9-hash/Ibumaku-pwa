import React from 'react';
import { useNavigate } from 'react-router-dom';
import DocView from '../components/DocView';
import safetyContent from '../content/safety.md?raw';
import { blockConsent, clearConsentBlock, hasSafetyConsent, setSafetyConsent } from '../logic/consent';

export default function NoticeSafetyPage() {
  const nav = useNavigate();
  const alreadyAgreed = hasSafetyConsent();

  const onAgree = () => {
    clearConsentBlock();
    setSafetyConsent(true);
    nav('/terms', { replace: true });
  };

  const onDisagree = () => {
    setSafetyConsent(false);
    blockConsent();
    nav('/exit', { replace: true });
  };

  return (
    <DocView
      title="安全に関する注意"
      content={safetyContent}
      actions={
        alreadyAgreed ? null : (
          <>
            <button className="btn primary" onClick={onAgree}>同意する</button>
            <button className="btn" onClick={onDisagree}>同意しない</button>
          </>
        )
      }
    />
  );
}
