import { FlaskConical, Workflow } from 'lucide-react';
import { Button } from '../ui';

export type FirstRunGoal = 'workflow' | 'testSuite';

/**
 * First-run middle-editor hero with two large CTAs (workflow / test suite).
 * Replaces the mini-guide goal cards — the FirstRunGuide banner above the
 * editor handles the step-by-step walk-through after click. Designed to
 * fill the empty workspace so newbies see one obvious next action.
 */
export function GoalPicker({
  onPick,
  onDismiss,
}: {
  onPick: (goal: FirstRunGoal) => void;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div className="first-run-hero">
      <div className="first-run-hero-head">
        <h1 className="first-run-hero-title">What do you want to build?</h1>
        <p className="first-run-hero-sub">
          Pick one to get started. You can always change later.
        </p>
      </div>

      <div className="first-run-hero-actions">
        <button
          type="button"
          className="first-run-hero-cta"
          onClick={() => onPick('workflow')}
        >
          <span className="first-run-hero-cta-icon" aria-hidden>
            <Workflow size={36} />
          </span>
          <span className="first-run-hero-cta-label">New workflow</span>
          <span className="first-run-hero-cta-hint">
            Chain tx + airdrops + warps. Halts on first failed tx.
          </span>
        </button>

        <button
          type="button"
          className="first-run-hero-cta"
          onClick={() => onPick('testSuite')}
        >
          <span className="first-run-hero-cta-icon" aria-hidden>
            <FlaskConical size={36} />
          </span>
          <span className="first-run-hero-cta-label">New test suite</span>
          <span className="first-run-hero-cta-hint">
            Multi-case assertions on tx outcome + account state.
          </span>
        </button>
      </div>

      <div className="first-run-hero-skip">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Just let me explore
        </Button>
      </div>
    </div>
  );
}
