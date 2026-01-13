import React, { Fragment } from 'react';

type Props = {
  title: string;
  content: string;
  actions?: React.ReactNode;
};

type DocBlock =
  | { type: 'spacer' }
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'para'; text: string }
  | { type: 'list'; items: string[] };

function stripTrailingMdSpaces(line: string): string {
  // Many of our docs use "two spaces" for Markdown line breaks.
  return line.replace(/\s+$/g, '').replace(/ {2}$/g, '');
}

function parseBlocks(raw: string): { blocks: DocBlock[]; metaLines: string[] } {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  // Drop leading "# ..." title line (DocView already renders the title).
  while (lines.length && lines[0].trim().startsWith('# ')) lines.shift();

  const metaPrefixes = ['最終更新日：', '運営者（提供者）：', '問い合わせ：', '問い合わせ窓口：'];
  const metaLines: string[] = [];
  const bodyLines: string[] = [];

  for (const ln0 of lines) {
    const ln = stripTrailingMdSpaces(ln0);
    const t = ln.trim();
    if (metaPrefixes.some(p => t.startsWith(p))) {
      metaLines.push(t);
      continue;
    }
    if (t === '---') {
      // Treat horizontal rule as just spacing.
      bodyLines.push('');
      continue;
    }
    bodyLines.push(ln);
  }

  const blocks: DocBlock[] = [];
  let i = 0;
  const pushSpacer = () => {
    // Avoid stacking too many spacers.
    if (!blocks.length || blocks[blocks.length - 1].type !== 'spacer') blocks.push({ type: 'spacer' });
  };

  while (i < bodyLines.length) {
    const line = bodyLines[i];
    const t = line.trim();

    if (t === '') {
      pushSpacer();
      i += 1;
      continue;
    }

    const m2 = t.match(/^(##|###)\s+(.+)$/);
    if (m2) {
      const level = m2[1] === '##' ? 2 : 3;
      blocks.push({ type: 'heading', level, text: m2[2].trim() });
      i += 1;
      continue;
    }

    // Bullet list: "- xxx"
    if (t.startsWith('- ')) {
      const items: string[] = [];
      while (i < bodyLines.length) {
        const tt = bodyLines[i].trim();
        if (!tt.startsWith('- ')) break;
        items.push(tt.slice(2).trim());
        i += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // Paragraph: collect until blank / heading / list
    const para: string[] = [];
    while (i < bodyLines.length) {
      const l = bodyLines[i];
      const tt = l.trim();
      if (tt === '') break;
      if (tt === '---') break;
      if (/^(##|###)\s+/.test(tt)) break;
      if (tt.startsWith('- ')) break;
      // Drop single-# headings as we don't use them in this UI.
      if (tt.startsWith('# ')) { i += 1; continue; }
      para.push(l);
      i += 1;
    }
    blocks.push({ type: 'para', text: para.join('\n') });
  }

  // Clean leading/trailing spacers
  while (blocks.length && blocks[0].type === 'spacer') blocks.shift();
  while (blocks.length && blocks[blocks.length - 1].type === 'spacer') blocks.pop();

  return { blocks, metaLines };
}

function renderDocContent(raw: string): { nodes: React.ReactNode[]; metaLines: string[] } {
  const { blocks, metaLines } = parseBlocks(raw);
  const nodes: React.ReactNode[] = [];

  blocks.forEach((b, idx) => {
    if (b.type === 'spacer') {
      nodes.push(<div key={`sp-${idx}`} style={{ height: 10 }} />);
      return;
    }
    if (b.type === 'heading') {
      nodes.push(
        <div
          key={`h-${idx}`}
          className={b.level === 2 ? 'docHeading2' : 'docHeading3'}
        >
          <strong>{b.text}</strong>
        </div>
      );
      return;
    }
    if (b.type === 'list') {
      nodes.push(
        <ul key={`ul-${idx}`} className="docList">
          {b.items.map((it, j) => (
            <li key={`li-${idx}-${j}`}>{it}</li>
          ))}
        </ul>
      );
      return;
    }
    // paragraph
    nodes.push(
      <div key={`p-${idx}`} className="docPara" style={{ whiteSpace: 'pre-wrap' }}>
        {b.text}
      </div>
    );
  });

  return { nodes, metaLines };
}

export default function DocView({ title, content, actions }: Props) {
  const { nodes, metaLines } = renderDocContent(content);
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="docBody" style={{ overflowWrap: 'anywhere' }}>
        {nodes}
      </div>

      {metaLines.length ? (
        <div className="docMeta" style={{ marginTop: 14 }}>
          {metaLines.map((m, idx) => (
            <Fragment key={`meta-${idx}`}>
              <div>{m}</div>
            </Fragment>
          ))}
        </div>
      ) : null}

      {actions ? (
        <>
          <div style={{ height: 12 }} />
          <div className="actions">{actions}</div>
        </>
      ) : null}
    </div>
  );
}
