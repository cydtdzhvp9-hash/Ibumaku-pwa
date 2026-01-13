import React from 'react';
import DocView from '../components/DocView';
import privacyContent from '../content/privacy.md?raw';

export default function PrivacyPage() {
  return <DocView title="プライバシーポリシー" content={privacyContent} />;
}
