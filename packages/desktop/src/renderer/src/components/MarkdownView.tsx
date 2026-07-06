import { useMemo } from 'react';
import { marked } from 'marked';

marked.use({ async: false, gfm: true, breaks: true });

interface Props {
  source: string;
  className?: string;
}

// Renders user-entered markdown (workflow / test-suite / case descriptions).
// Falls back to null when source is empty - the caller renders its own "no description" hint.
export function MarkdownView({ source, className }: Props) {
  const html = useMemo(() => {
    if (!source?.trim()) return '';
    return marked.parse(source) as string;
  }, [source]);

  if (!html) return null;

  return (
    <div
      className={['md-body', className].filter(Boolean).join(' ')}
      // why: marked output, locally-authored content, no remote html.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
