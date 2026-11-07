import { Fragment, type ReactNode } from 'react';

interface Props {
  text: string;
  compact?: boolean;
}

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\|\|[^|]+\|\||`[^`]+`|\*[^*]+\*|_[^_]+_|https?:\/\/[^\s]+)/gu;

function renderInline(text: string, prefix = 'i'): ReactNode[] {
  const parts = text.split(INLINE).filter((part) => part.length > 0);
  return parts.map((part, index) => {
    const key = `${prefix}-${index}`;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{renderInline(part.slice(2, -2), `${key}-b`)}</strong>;
    if (part.startsWith('__') && part.endsWith('__')) return <u key={key}>{renderInline(part.slice(2, -2), `${key}-u`)}</u>;
    if (part.startsWith('~~') && part.endsWith('~~')) return <del key={key}>{renderInline(part.slice(2, -2), `${key}-s`)}</del>;
    if (part.startsWith('||') && part.endsWith('||')) return <span key={key} className="discord-spoiler">{renderInline(part.slice(2, -2), `${key}-p`)}</span>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>;
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) return <em key={key}>{renderInline(part.slice(1, -1), `${key}-e`)}</em>;
    if (/^https?:\/\//u.test(part)) return <span key={key} className="discord-link">{part}</span>;
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function DiscordText({ text, compact = false }: Props) {
  const lines = String(text || '').replace(/\r\n/gu, '\n').split('\n');
  const nodes: ReactNode[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  const flushCode = (key: string) => {
    if (!codeLines.length) return;
    nodes.push(<pre key={key} className="discord-codeblock"><code>{codeLines.join('\n')}</code></pre>);
    codeLines = [];
  };

  lines.forEach((line, index) => {
    const key = `line-${index}`;
    if (line.trim().startsWith('```')) {
      if (inCode) flushCode(`${key}-code`);
      inCode = !inCode;
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }
    if (!line.trim()) {
      nodes.push(<div key={key} className="discord-gap" />);
      return;
    }

    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4';
      nodes.push(<Tag key={key}>{renderInline(heading[2], key)}</Tag>);
      return;
    }

    const quote = /^>\s?(.*)$/u.exec(line);
    if (quote) {
      nodes.push(<blockquote key={key}>{renderInline(quote[1], key)}</blockquote>);
      return;
    }

    const bullet = /^[-*]\s+(.+)$/u.exec(line);
    if (bullet) {
      nodes.push(<div key={key} className="discord-list-row"><span>•</span><div>{renderInline(bullet[1], key)}</div></div>);
      return;
    }

    const ordered = /^(\d+)\.\s+(.+)$/u.exec(line);
    if (ordered) {
      nodes.push(<div key={key} className="discord-list-row"><span>{ordered[1]}.</span><div>{renderInline(ordered[2], key)}</div></div>);
      return;
    }

    nodes.push(<p key={key}>{renderInline(line, key)}</p>);
  });

  if (inCode) flushCode('code-final');

  return <div className={`discord-copy${compact ? ' discord-copy-compact' : ''}`}>{nodes}</div>;
}
