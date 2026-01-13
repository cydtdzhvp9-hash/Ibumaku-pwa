import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import DocView from '../components/DocView';
import termsContent from '../content/terms.md?raw';
import { blockConsent, hasTermsConsent, setTermsConsent } from '../logic/consent';

export default function TermsPage() {
  const nav = useNavigate();
  const alreadyAgreed = hasTermsConsent();

  // When navigating from the previous consent page, browsers may retain the scroll position.
  // Ensure the next document starts at the top.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  const onAgree = () => {
    setTermsConsent(true);
    nav('/', { replace: true });
  };

  const onDisagree = () => {
    setTermsConsent(false);
    blockConsent();
    nav('/exit', { replace: true });
  };

  return (
    <DocView
      title="利用規約"
      content={termsContent}
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
