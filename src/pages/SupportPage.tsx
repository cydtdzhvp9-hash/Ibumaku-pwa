import React from 'react';
import DocView from '../components/DocView';
import supportContent from '../content/support.md?raw';

export default function SupportPage() {
  return <DocView title="サポート・ヘルプ" content={supportContent} />;
}
