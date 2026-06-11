import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { rust } from '@codemirror/lang-rust';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import CodeMirror, { type Extension } from '@uiw/react-codemirror';
import { useMemo } from 'react';
import { cn } from './cn';

export type CodeLang = 'json' | 'markdown' | 'rust' | 'typescript' | 'javascript' | 'text';

export function detectLanguage(path: string): CodeLang {
  const p = path.toLowerCase();
  if (p.endsWith('.json')) return 'json';
  if (p.endsWith('.md') || p.endsWith('.mdx') || p.endsWith('.markdown')) return 'markdown';
  if (p.endsWith('.rs')) return 'rust';
  if (p.endsWith('.ts') || p.endsWith('.tsx')) return 'typescript';
  if (p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.mjs') || p.endsWith('.cjs')) {
    return 'javascript';
  }
  return 'text';
}

function langExtension(l: CodeLang): Extension[] {
  switch (l) {
    case 'json':
      return [json()];
    case 'markdown':
      return [markdown()];
    case 'rust':
      return [rust()];
    case 'typescript':
      return [javascript({ jsx: true, typescript: true })];
    case 'javascript':
      return [javascript({ jsx: true })];
    case 'text':
    default:
      return [];
  }
}

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  language: CodeLang;
  /** Min height. Default 360. */
  minHeight?: number | string;
  /** Max height. Default unbounded. */
  height?: number | string;
  readOnly?: boolean;
  className?: string;
}

export function CodeEditor({
  value,
  onChange,
  language,
  minHeight = 360,
  height,
  readOnly,
  className,
}: CodeEditorProps): JSX.Element {
  const extensions = useMemo<Extension[]>(
    () => [
      ...langExtension(language),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': { fontSize: '12px' },
        '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, "JetBrains Mono", Consolas, monospace' },
        '.cm-gutters': { backgroundColor: 'rgb(var(--color-bg))', border: 'none' },
        '&.cm-focused': { outline: 'none' },
      }),
    ],
    [language],
  );

  return (
    <div className={cn('rounded-md border border-border overflow-hidden bg-bg', className)}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={oneDark}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          bracketMatching: true,
          autocompletion: true,
          searchKeymap: true,
          tabSize: 2,
        }}
        minHeight={typeof minHeight === 'number' ? `${minHeight}px` : minHeight}
        height={typeof height === 'number' ? `${height}px` : height}
        style={{ fontSize: 12 }}
      />
    </div>
  );
}
