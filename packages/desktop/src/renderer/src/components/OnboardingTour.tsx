import { useEffect, useState } from 'react';
import { Box, FileCode2, Inspect, MessageSquare, X } from 'lucide-react';

const STORAGE_KEY = 'relay:onboarding-tour-done';

interface Step {
  icon: JSX.Element;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: <Box size={28} aria-hidden />,
    title: 'Sidebar = your stuff',
    body: 'Programs, sandboxes, templates, workflows, tests, and patches all live in the left sidebar. Sections collapse independently — keep what you use open.',
  },
  {
    icon: <FileCode2 size={28} aria-hidden />,
    title: 'Workspace = where you build',
    body: 'Tx Builder, Automations, and Patches each get their own workspace tab. Switch tabs at the top of the editor. The sidebar drives what loads here.',
  },
  {
    icon: <Inspect size={28} aria-hidden />,
    title: 'Right pane = inspect & help',
    body: 'Click an account, ix, or tx to inspect. Help skill docs live here too — toggle with ⌘⌥B.',
  },
  {
    icon: <MessageSquare size={28} aria-hidden />,
    title: 'Bottom dock = history & logs',
    body: 'Recent tx submissions + per-tx logs collapse into a VSCode-style dock at the bottom. Toggle with ⌘J or the dock icon in the top toolbar.',
  },
];

/**
 * One-shot first-launch overlay tour. Renders nothing once the user has
 * completed or skipped it (persisted via localStorage). Designed for newbie
 * orientation — never replays automatically. Re-openable from the command
 * palette ("Open glossary / help") if we wire it up later.
 */
export function OnboardingTour(): JSX.Element | null {
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) !== '1';
  });
  const [idx, setIdx] = useState(0);

  const dismiss = (): void => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss();
      if (e.key === 'ArrowRight') setIdx((i) => Math.min(i + 1, STEPS.length - 1));
      if (e.key === 'ArrowLeft') setIdx((i) => Math.max(i - 1, 0));
      if (e.key === 'Enter') {
        if (idx >= STEPS.length - 1) dismiss();
        else setIdx((i) => i + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, idx]);

  if (!visible) return null;
  const step = STEPS[idx]!;
  const isLast = idx >= STEPS.length - 1;

  return (
    <div className="onboarding-tour-backdrop" onClick={dismiss}>
      <div
        className="onboarding-tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="onboarding-tour-close"
          onClick={dismiss}
          title="Skip tour"
          aria-label="Skip tour"
        >
          <X size={14} aria-hidden />
        </button>
        <div className="onboarding-tour-icon" aria-hidden>
          {step.icon}
        </div>
        <h2 id="onboarding-title" className="onboarding-tour-title">
          {step.title}
        </h2>
        <p className="onboarding-tour-body">{step.body}</p>
        <div className="onboarding-tour-dots">
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`onboarding-tour-dot${i === idx ? ' active' : ''}`}
              onClick={() => setIdx(i)}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>
        <div className="onboarding-tour-actions">
          <button type="button" className="onboarding-tour-skip" onClick={dismiss}>
            Skip
          </button>
          <button
            type="button"
            className="onboarding-tour-next"
            onClick={() => {
              if (isLast) dismiss();
              else setIdx((i) => i + 1);
            }}
          >
            {isLast ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
