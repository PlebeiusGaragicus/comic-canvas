import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MessageSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'skill'; name: string; location?: string; body: string };

function parseSkillAttributes(attributes: string) {
  const name = attributes.match(/\bname="([^"]*)"/)?.[1] ?? 'skill';
  const location = attributes.match(/\blocation="([^"]*)"/)?.[1];
  return { name, location };
}

export function parseMessageSegments(text: string): MessageSegment[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const slashSkill = trimmed.match(/^\/skill:([\w-]+)(?:\s+([\s\S]*))?$/);
  if (slashSkill) {
    return [{
      kind: 'skill',
      name: slashSkill[1],
      body: (slashSkill[2] ?? '').trim(),
    }];
  }

  const segments: MessageSegment[] = [];
  const skillRegex = /<skill\s+([^>]*)>([\s\S]*?)<\/skill>/gi;
  let lastIndex = 0;
  for (const match of trimmed.matchAll(skillRegex)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ kind: 'markdown', text: trimmed.slice(lastIndex, index) });
    }
    const { name, location } = parseSkillAttributes(match[1]);
    segments.push({
      kind: 'skill',
      name,
      location,
      body: match[2].trim(),
    });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < trimmed.length) {
    segments.push({ kind: 'markdown', text: trimmed.slice(lastIndex) });
  }

  if (!segments.length) {
    segments.push({ kind: 'markdown', text: trimmed });
  }

  return segments.filter((segment) => (
    segment.kind === 'skill' || segment.text.trim().length > 0
  ));
}

function shortenPath(value: string | undefined) {
  if (!value) return null;
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length <= 3) return normalized;
  return `…/${parts.slice(-3).join('/')}`;
}

function PiSkillBlock({
  name,
  location,
  body,
  defaultOpen = false,
}: {
  name: string;
  location?: string;
  body: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const locationLabel = shortenPath(location);

  return (
    <div className="pi-trace-skill">
      <button type="button" className="pi-trace-skill-head" onClick={() => setOpen((value) => !value)}>
        <span className="pi-trace-skill-label">Skill · {name}</span>
        {locationLabel && <span className="pi-trace-skill-path">{locationLabel}</span>}
        <span className="pi-trace-skill-toggle">{open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <div className="pi-trace-skill-body">
          {body ? <MarkdownContent text={body} /> : <p className="muted">No additional instructions.</p>}
        </div>
      )}
    </div>
  );
}

export function MarkdownContent({ text, className }: { text: string; className?: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  return (
    <div className={className ? `pi-trace-markdown ${className}` : 'pi-trace-markdown'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{trimmed}</ReactMarkdown>
    </div>
  );
}

export function TraceMessageContent({ text }: { text: string }) {
  const segments = useMemo(() => parseMessageSegments(text), [text]);

  if (!segments.length) return null;

  return (
    <div className="pi-trace-message-content">
      {segments.map((segment, index) => {
        if (segment.kind === 'skill') {
          return (
            <PiSkillBlock
              key={`skill-${segment.name}-${index}`}
              name={segment.name}
              location={segment.location}
              body={segment.body}
            />
          );
        }
        return <MarkdownContent key={`md-${index}`} text={segment.text} />;
      })}
    </div>
  );
}
