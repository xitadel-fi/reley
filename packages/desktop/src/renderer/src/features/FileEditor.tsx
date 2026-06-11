import { AlertTriangle, Eye, File as FileIcon, FileCode, RotateCcw, Save } from 'lucide-react';
import { marked } from 'marked';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/Toast';
import {
  Button,
  CodeEditor,
  Empty,
  ErrorState,
  Spinner,
  detectLanguage,
} from '../ui';

interface ReadResult {
  path: string;
  content: string;
  mtime: number;
}

export interface FileEditorProps {
  path: string | null;
  onSaved?: (path: string) => void;
}

marked.use({ async: false, gfm: true, breaks: false });

export function FileEditor({ path, onSaved }: FileEditorProps): JSX.Element {
  const [content, setContent] = useState<string>('');
  const [original, setOriginal] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [mdPreview, setMdPreview] = useState(false);
  const toast = useToast();
  // Save handler ref so the global keydown listener always reads the latest
  // version without re-binding.
  const saveRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    if (!path) return;
    setLoading(true);
    setReadErr(null);
    void api
      .call<ReadResult>('app.files.read', { path })
      .then((r) => {
        setContent(r.content);
        setOriginal(r.content);
      })
      .catch((e) => {
        setReadErr(String(e));
        setContent('');
        setOriginal('');
      })
      .finally(() => setLoading(false));
  }, [path]);

  const dirty = content !== original;
  const language = useMemo(() => (path ? detectLanguage(path) : 'text'), [path]);
  const isJson = language === 'json';
  const isMarkdown = language === 'markdown';

  const jsonError = useMemo<string | null>(() => {
    if (!isJson || !dirty) return null;
    try {
      JSON.parse(content);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [isJson, content, dirty]);

  const markdownHtml = useMemo<string | null>(() => {
    if (!isMarkdown || !mdPreview) return null;
    try {
      return marked.parse(content) as string;
    } catch (e) {
      return `<pre class="text-danger">${escapeHtml((e as Error).message)}</pre>`;
    }
  }, [isMarkdown, mdPreview, content]);

  const save = async (): Promise<void> => {
    if (!path) return;
    if (!dirty || jsonError) return;
    setSaving(true);
    try {
      await api.call('app.files.write', { path, content });
      setOriginal(content);
      toast.success(`saved ${path}`);
      onSaved?.(path);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  // Keep ref in sync so the keydown handler always saves the latest content.
  saveRef.current = save;

  useEffect(() => {
    if (!path) return;
    const onKey = (e: KeyboardEvent): void => {
      const isCmd = e.metaKey || e.ctrlKey;
      if (isCmd && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [path]);

  if (!path) {
    return (
      <Empty
        size="sm"
        icon={<FileIcon size={20} aria-hidden />}
        title="Pick a file"
        description="Select one in the sidebar tree to edit."
      />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between gap-2 px-3 h-9 border-b border-border bg-surface-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode size={12} className="text-text-subtle shrink-0" aria-hidden />
          <span className="font-mono text-xs text-text truncate">{path}</span>
          <span className="text-2xs text-text-subtle uppercase tracking-wider shrink-0">
            {language}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {isMarkdown && (
            <Button
              variant={mdPreview ? 'primary' : 'ghost'}
              size="xs"
              onClick={() => setMdPreview((v) => !v)}
              title="Toggle markdown preview"
            >
              <Eye size={11} aria-hidden /> Preview
            </Button>
          )}
          {dirty && !jsonError && <span className="text-2xs text-warning">unsaved</span>}
          {jsonError && (
            <span className="inline-flex items-center gap-1 text-2xs text-danger">
              <AlertTriangle size={11} aria-hidden /> JSON invalid
            </span>
          )}
          <Button variant="ghost" size="xs" onClick={() => setContent(original)} disabled={!dirty}>
            <RotateCcw size={11} aria-hidden /> Revert
          </Button>
          <Button
            variant="primary"
            size="xs"
            onClick={() => void save()}
            disabled={!dirty || saving || !!jsonError}
            title="Save (⌘S)"
          >
            {saving ? <Spinner size={11} /> : <Save size={11} aria-hidden />} Save
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="p-3">
            <Spinner label="Loading…" />
          </div>
        ) : readErr ? (
          <div className="p-3">
            <ErrorState title="Failed to read" message={readErr} />
          </div>
        ) : isMarkdown && mdPreview && markdownHtml != null ? (
          <div className="overflow-auto h-full bg-bg p-8 prose-content">
            <div dangerouslySetInnerHTML={{ __html: markdownHtml }} />
          </div>
        ) : (
          <CodeEditor
            value={content}
            onChange={setContent}
            language={language}
            minHeight="100%"
            height="100%"
            className="h-full border-0 rounded-none"
          />
        )}
      </div>
      {jsonError && (
        <div className="px-3 py-2 border-t border-border bg-surface-0 text-2xs text-danger break-words">
          {jsonError}
        </div>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
