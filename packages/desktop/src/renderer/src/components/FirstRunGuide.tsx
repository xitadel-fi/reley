import { Sparkles, X } from 'lucide-react';
import { useState } from 'react';

type Kind = 'workflow' | 'testSuite';

const COPY: Record<Kind, { title: string; steps: string[] }> = {
  workflow: {
    title: 'Creating your first workflow',
    steps: [
      'Name it (e.g. "happy path", "swap-then-withdraw")',
      'Add steps below — pick from Tx ops / Time ops / Reset / Version',
      'Save and run. Workflow halts on first failed tx.',
    ],
  },
  testSuite: {
    title: 'Creating your first test suite',
    steps: [
      'Name the suite + add a test case',
      'Add steps to the case (Tx ops, warps, resets)',
      'Attach expectations per step (succeed/fail/CU/account state)',
      'Save and run. Steps never halt the suite — failures become assertions.',
    ],
  },
};

/** Inline dismissable banner shown above the workflow/test editor on first
 *  creation. Dismiss persisted per kind so it never reappears for that user. */
export function FirstRunGuide({ kind }: { kind: Kind }): JSX.Element | null {
  const storageKey = `relay:guide-${kind}-done`;
  const [hidden, setHidden] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(storageKey) === '1';
  });

  if (hidden) return null;
  const copy = COPY[kind];

  const dismiss = (): void => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, '1');
    setHidden(true);
  };

  return (
    <div className="first-run-guide">
      <span className="first-run-guide-icon" aria-hidden>
        <Sparkles size={14} />
      </span>
      <div className="first-run-guide-body">
        <div className="first-run-guide-title">{copy.title}</div>
        <ol className="first-run-guide-steps">
          {copy.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
      <button
        type="button"
        className="first-run-guide-close"
        onClick={dismiss}
        title="Dismiss"
        aria-label="Dismiss guide"
      >
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}
