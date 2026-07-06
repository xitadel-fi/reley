import { ChevronDown, FileText, Search, X } from 'lucide-react';
import { marked } from 'marked';
import { useEffect, useMemo, useRef, useState } from 'react';

marked.use({ async: false, gfm: true, breaks: false });

// Vite eager-imports bundled SKILL.md as raw strings. Path resolves from
// renderer src → up to package root → into the skills/ folder shipped
// alongside the app.
const SKILL_MODULES = import.meta.glob<string>('../../../../skills/*/SKILL.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

interface SkillMeta {
  id: string;
  /** Friendly title — last segment of `relay-foo` → "Foo". */
  title: string;
  /** Frontmatter `description:` value if present. */
  description: string;
  body: string;
}

function parseFrontmatter(md: string): { description: string; rest: string } {
  if (!md.startsWith('---')) return { description: '', rest: md };
  const end = md.indexOf('\n---', 3);
  if (end < 0) return { description: '', rest: md };
  const head = md.slice(3, end);
  const rest = md.slice(end + 4).replace(/^\s*\n/, '');
  const m = head.match(/description:\s*(.*)/);
  const description = m?.[1]?.trim() ?? '';
  return { description, rest };
}

function titleFor(id: string): string {
  // relay-foo-bar → "Foo bar"
  return id
    .replace(/^relay-?/i, '')
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || id;
}

const SKILLS: SkillMeta[] = Object.entries(SKILL_MODULES)
  .map(([path, body]) => {
    const m = path.match(/skills\/([^/]+)\/SKILL\.md$/);
    const id = m?.[1] ?? path;
    const { description } = parseFrontmatter(body);
    return { id, title: titleFor(id), description, body };
  })
  .sort((a, b) => {
    const order = [
      'reley-overview',
      'reley-sandbox',
      'reley-workflow',
      'reley-tests',
      'reley-patch',
      'reley-versions',
      'reley-tx-template',
      'reley-account',
      'reley-keypair',
      'reley-snapshot',
      'reley-troubleshooting',
    ];
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.id.localeCompare(b.id);
  });

export function HelpPanel({ initialSkillId }: { initialSkillId?: string }): JSX.Element {
  const [activeId, setActiveId] = useState<string>(
    initialSkillId && SKILLS.some((s) => s.id === initialSkillId)
      ? initialSkillId
      : (SKILLS[0]?.id ?? ''),
  );
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const articleRef = useRef<HTMLElement>(null);

  // Scroll the article back to the top when the active skill changes.
  useEffect(() => {
    if (articleRef.current) articleRef.current.scrollTop = 0;
  }, [activeId]);

  // Sync external skill changes (HelpChip click).
  useEffect(() => {
    if (initialSkillId && SKILLS.some((s) => s.id === initialSkillId)) {
      setActiveId(initialSkillId);
    }
  }, [initialSkillId]);

  const active = SKILLS.find((s) => s.id === activeId);

  const filtered = useMemo(() => {
    if (!query.trim()) return SKILLS;
    const q = query.toLowerCase();
    return SKILLS.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.body.toLowerCase().includes(q),
    );
  }, [query]);

  const html = useMemo(() => {
    if (!active) return '';
    const { rest } = parseFrontmatter(active.body);
    return marked.parse(rest) as string;
  }, [active]);

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {/* Skill picker — custom dropdown with title + description per entry. */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className={[
            'w-full flex items-center gap-2 text-left',
            'bg-surface-0 border border-border rounded px-2.5 py-1.5',
            'hover:border-accent/60 transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
          ].join(' ')}
          aria-expanded={pickerOpen}
        >
          <FileText size={13} className="text-accent shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-text truncate">
              {active?.title ?? '—'}
            </div>
            <div className="text-2xs text-text-subtle font-mono truncate">
              {active?.id ?? ''}
            </div>
          </div>
          <ChevronDown
            size={12}
            aria-hidden
            className={[
              'text-text-muted shrink-0 transition-transform',
              pickerOpen ? 'rotate-180' : '',
            ].join(' ')}
          />
        </button>
        {pickerOpen && (
          <div
            className="absolute z-10 top-full left-0 right-0 mt-1 max-h-[60vh] overflow-auto rounded-md border border-border bg-surface-0 shadow-elev-3 p-1"
            onMouseLeave={() => setPickerOpen(false)}
          >
            {SKILLS.map((s) => {
              const isActive = s.id === activeId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setActiveId(s.id);
                    setPickerOpen(false);
                  }}
                  className={[
                    'w-full text-left rounded px-2 py-1.5 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/60',
                    isActive
                      ? 'bg-accent/15 text-accent'
                      : 'hover:bg-surface-1 text-text',
                  ].join(' ')}
                >
                  <div className="text-xs font-medium truncate">{s.title}</div>
                  <div className="text-2xs text-text-subtle truncate">{s.description}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Search across all skills. Surfacing matches narrows the picker too. */}
      <div className="relative">
        <Search
          size={11}
          aria-hidden
          className="absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle pointer-events-none"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search docs…"
          className="w-full bg-surface-0 border border-border rounded pl-7 pr-7 py-1 text-2xs text-text outline-none focus:border-accent"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 rounded text-text-subtle hover:text-text hover:bg-surface-1"
          >
            <X size={10} aria-hidden />
          </button>
        )}
      </div>
      {query.trim() && (
        <div className="text-2xs text-text-subtle flex flex-wrap gap-1">
          {filtered.length === 0 ? (
            <span>no skills match</span>
          ) : (
            filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                className={[
                  'inline-flex items-center px-1.5 py-0.5 rounded border text-2xs transition-colors',
                  s.id === activeId
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-border bg-surface-0 text-text-muted hover:text-text hover:bg-surface-1',
                ].join(' ')}
              >
                {s.title}
              </button>
            ))
          )}
        </div>
      )}

      {/* Description blurb — pulled from the SKILL.md frontmatter. */}
      {active?.description && (
        <div className="text-2xs text-text-muted leading-relaxed border-l-2 border-accent/40 pl-2.5 py-1">
          {active.description}
        </div>
      )}

      <article
        ref={articleRef}
        className="help-markdown overflow-auto pr-1 min-w-0"
        style={{ maxHeight: 'calc(100vh - 220px)' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
