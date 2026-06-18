import { Activity, Clock, FlaskConical, Workflow } from 'lucide-react';
import { useMemo } from 'react';
import type { Project } from '../types';
import { GoalPicker, type FirstRunGoal } from './GoalPicker';

interface WorkflowMeta {
  id: string;
  name: string;
  steps?: Array<{ id: string }>;
  updatedAt?: number;
}

interface TestSuiteMeta {
  id: string;
  name: string;
  cases?: Array<{ id: string; steps?: Array<{ id: string }> }>;
  updatedAt?: number;
}

type RecentKind = 'workflow' | 'testSuite';

interface RecentEntry {
  kind: RecentKind;
  id: string;
  name: string;
  count: number;
  lastRunAt: number;
}

const LSTORE_PREFIX = 'relay:lastrun:';

/** localStorage helper — last-run timestamp by id. Returns 0 when unset. */
function lastRunAt(kind: RecentKind, id: string): number {
  if (typeof localStorage === 'undefined') return 0;
  const raw = localStorage.getItem(`${LSTORE_PREFIX}${kind}:${id}`);
  return raw ? Number(raw) || 0 : 0;
}

/** Record a run timestamp. Call after a successful (or any) run. */
export function recordRun(kind: RecentKind, id: string): void {
  if (typeof localStorage === 'undefined' || !id) return;
  localStorage.setItem(`${LSTORE_PREFIX}${kind}:${id}`, String(Date.now()));
}

function ago(ms: number): string {
  if (ms <= 0) return 'never';
  const d = Date.now() - ms;
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Automations workspace landing page. Shows recently-run workflows and test
 * suites as clickable cards. When no run history exists, falls back to the
 * 2-button GoalPicker so newbies see the next action.
 */
export function AutomationsHome({
  project,
  goalDismissed = false,
  onOpen,
  onPick,
  onDismissGoal,
}: {
  project: Project;
  /** When true, suppress GoalPicker on empty state and show a compact prompt. */
  goalDismissed?: boolean;
  /** Open an item in detail view (kind + id). */
  onOpen: (kind: RecentKind, id: string) => void;
  /** First-run CTA picker — used when the home is empty. */
  onPick: (goal: FirstRunGoal) => void;
  /** Dismiss the goal picker — same callback used by GoalPicker. */
  onDismissGoal: () => void;
}): JSX.Element {
  const workflows = (project.workflows ?? []) as WorkflowMeta[];
  const testSuites = (project.testSuites ?? []) as TestSuiteMeta[];

  const recent = useMemo<RecentEntry[]>(() => {
    const all: RecentEntry[] = [];
    for (const w of workflows) {
      const ts = lastRunAt('workflow', w.id);
      if (ts > 0) {
        all.push({
          kind: 'workflow',
          id: w.id,
          name: w.name,
          count: w.steps?.length ?? 0,
          lastRunAt: ts,
        });
      }
    }
    for (const s of testSuites) {
      const ts = lastRunAt('testSuite', s.id);
      if (ts > 0) {
        all.push({
          kind: 'testSuite',
          id: s.id,
          name: s.name,
          count: s.cases?.length ?? 0,
          lastRunAt: ts,
        });
      }
    }
    return all.sort((a, b) => b.lastRunAt - a.lastRunAt).slice(0, 12);
  }, [workflows, testSuites]);

  // No run history yet. Show big CTAs unless the user already dismissed —
  // in that case render a compact home with primary "+ New" buttons so the
  // workspace isn't empty.
  if (recent.length === 0) {
    if (!goalDismissed) {
      return <GoalPicker onPick={onPick} onDismiss={onDismissGoal} />;
    }
    return (
      <div className="entity-detail">
        <div className="entity-detail-section">
          <div className="entity-detail-section-head">
            <h3 className="entity-detail-section-title">No recent runs</h3>
            <span className="entity-detail-section-meta">
              Create something or pick from the sidebar.
            </span>
          </div>
          <div className="recent-runs-grid">
            <button
              type="button"
              className="recent-run-card"
              onClick={() => onPick('workflow')}
            >
              <span className="recent-run-icon wf" aria-hidden>
                <Workflow size={16} />
              </span>
              <span className="recent-run-body">
                <span className="recent-run-name">New workflow</span>
                <span className="recent-run-meta">Chain tx + warps + resets</span>
              </span>
            </button>
            <button
              type="button"
              className="recent-run-card"
              onClick={() => onPick('testSuite')}
            >
              <span className="recent-run-icon ts" aria-hidden>
                <FlaskConical size={16} />
              </span>
              <span className="recent-run-body">
                <span className="recent-run-name">New test suite</span>
                <span className="recent-run-meta">Assert tx + state outcomes</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="entity-detail">
      <div className="entity-detail-hero">
        <div className="entity-detail-hero-main">
          <span className="entity-detail-hero-icon" aria-hidden>
            <Activity size={22} />
          </span>
          <div className="entity-detail-hero-text">
            <div className="entity-detail-hero-title-row">
              <h1 className="entity-detail-hero-title">Automations</h1>
              <span className="entity-pill entity-pill-workflow">Home</span>
            </div>
            <p className="entity-detail-hero-desc">
              Recently run workflows and test suites. Click one to view, edit, or re-run.
            </p>
          </div>
        </div>
      </div>

      <div className="entity-detail-section">
        <div className="entity-detail-section-head">
          <h3 className="entity-detail-section-title">Recent runs</h3>
          <span className="entity-detail-section-meta">
            {recent.length} item{recent.length === 1 ? '' : 's'}
          </span>
        </div>
        <ol className="recent-runs-grid">
          {recent.map((r) => {
            const isWf = r.kind === 'workflow';
            return (
              <li key={`${r.kind}:${r.id}`}>
                <button
                  type="button"
                  className="recent-run-card"
                  onClick={() => onOpen(r.kind, r.id)}
                >
                  <span
                    className={`recent-run-icon ${isWf ? 'wf' : 'ts'}`}
                    aria-hidden
                  >
                    {isWf ? <Workflow size={16} /> : <FlaskConical size={16} />}
                  </span>
                  <span className="recent-run-body">
                    <span className="recent-run-name">{r.name || '(unnamed)'}</span>
                    <span className="recent-run-meta">
                      {isWf
                        ? `${r.count} step${r.count === 1 ? '' : 's'}`
                        : `${r.count} case${r.count === 1 ? '' : 's'}`}
                      <span className="recent-run-dot">·</span>
                      <span className="recent-run-ago">
                        <Clock size={10} aria-hidden /> {ago(r.lastRunAt)}
                      </span>
                    </span>
                  </span>
                  <span
                    className={`entity-pill ${isWf ? 'entity-pill-workflow' : 'entity-pill-suite'}`}
                  >
                    {isWf ? 'WF' : 'TS'}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
