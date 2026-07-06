import { Box, FlaskConical, Play, Sparkles, Workflow as WorkflowIcon, X } from 'lucide-react';
import { useState } from 'react';

interface Step {
  icon: JSX.Element;
  title: string;
  body: string;
  cta: string;
  onAction: () => void;
}

/**
 * Persistent "What now?" panel shown in the workspace when a project is
 * freshly opened and has no programs, no workflows, no test suites. Walks
 * the user through the 3 minimum steps to do anything useful. One-shot
 * dismissable per project so it never nags returning users.
 */
export function EmptyProjectGuide({
  projectId,
  hasPrograms,
  hasAutomations,
  hasRun,
  onAddProgram,
  onNewWorkflow,
  onOpenAutomations,
}: {
  projectId: string;
  hasPrograms: boolean;
  hasAutomations: boolean;
  hasRun: boolean;
  onAddProgram: () => void;
  onNewWorkflow: () => void;
  onOpenAutomations: () => void;
}): JSX.Element | null {
  const storageKey = `relay:empty-project-guide-done:${projectId}`;
  const [hidden, setHidden] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(storageKey) === '1';
  });

  if (hidden) return null;
  if (hasPrograms && hasAutomations && hasRun) return null;

  const dismiss = (): void => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, '1');
    setHidden(true);
  };

  const steps: Step[] = [
    {
      icon: <Box size={18} />,
      title: 'Add a program',
      body: 'Click the button below or use the sidebar — Programs section → + button. Paste a base58 programId from any chain or pick a builtin.',
      cta: 'Add program',
      onAction: onAddProgram,
    },
    {
      icon: <WorkflowIcon size={18} />,
      title: 'Create a workflow or test',
      body: 'A workflow chains tx + warps to reproduce a scenario. A test suite adds expectations (success/CU/account-state) so you can assert behavior. Click below to start one.',
      cta: 'New workflow',
      onAction: onNewWorkflow,
    },
    {
      icon: <Play size={18} />,
      title: 'Run + read results',
      body: 'Click the Run button on any workflow/test. Output appears in the bottom dock under the Results tab (press ⌘J if dock is hidden).',
      cta: 'Open Automations',
      onAction: onOpenAutomations,
    },
  ];

  return (
    <div className="empty-project-guide">
      <div className="empty-project-guide-head">
        <span className="empty-project-guide-icon" aria-hidden>
          <Sparkles size={16} />
        </span>
        <div className="empty-project-guide-title">
          <span>Quick start</span>
          <span className="empty-project-guide-sub">3 steps to your first run</span>
        </div>
        <button
          type="button"
          className="empty-project-guide-close"
          onClick={dismiss}
          title="Dismiss for this project"
          aria-label="Dismiss"
        >
          <X size={13} aria-hidden />
        </button>
      </div>
      <ol className="empty-project-guide-steps">
        {steps.map((s, idx) => {
          const done =
            (idx === 0 && hasPrograms) ||
            (idx === 1 && hasAutomations) ||
            (idx === 2 && hasRun);
          return (
            <li key={idx} className={`empty-project-guide-step${done ? ' done' : ''}`}>
              <span className={`empty-project-guide-step-idx${done ? ' done' : ''}`}>
                {done ? '✓' : idx + 1}
              </span>
              <div className="empty-project-guide-step-body">
                <div className="empty-project-guide-step-head">
                  <span className="empty-project-guide-step-icon" aria-hidden>
                    {s.icon}
                  </span>
                  <span className="empty-project-guide-step-title">{s.title}</span>
                </div>
                <p className="empty-project-guide-step-text">{s.body}</p>
                {!done && (
                  <button
                    type="button"
                    className="empty-project-guide-step-cta"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      s.onAction();
                    }}
                  >
                    <FlaskConical size={11} aria-hidden /> {s.cta}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
