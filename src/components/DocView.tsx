import React from 'react';

type Props = {
  title: string;
  content: string;
  actions?: React.ReactNode;
};

export default function DocView({ title, content, actions }: Props) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{content}</div>
      {actions ? (
        <>
          <div style={{ height: 12 }} />
          <div className="actions">{actions}</div>
        </>
      ) : null}
    </div>
  );
}
