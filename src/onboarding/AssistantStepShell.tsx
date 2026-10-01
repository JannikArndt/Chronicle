// Shared presentational shell for every onboarding-assistant step: one
// prompt, one input area, progress dots, back/skip navigation.
// This is the single piece of visual/interaction consistency shared across
// assistants — no generic step-definition/runner abstraction on top of it.

import type { ReactNode } from "react";

interface AssistantStepShellProps {
  prompt: string;
  hint?: string;
  stepIndex: number; // 0-based count of steps already completed in this flow
  // When the flow knows how many steps it has, every dot is drawn and the
  // current one lit; otherwise the dots grow as steps are completed.
  totalSteps?: number;
  onBack?: () => void;
  onSkip: () => void;
  skipLabel?: string; // defaults to "Skip for now" — override when a step has a more accurate label for ending early (e.g. "That's all for now")
  className?: string;
  footer?: ReactNode; // below the navigation, edge to edge (the first-run preview)
  children: ReactNode;
}

export function AssistantStepShell({
  prompt,
  hint,
  stepIndex,
  totalSteps,
  onBack,
  onSkip,
  skipLabel = "Skip for now",
  className,
  footer,
  children,
}: AssistantStepShellProps) {
  const dotCount = totalSteps ?? stepIndex + 1;
  const dotClass = (index: number) =>
    index < stepIndex ? "assistant-dot-done" : index === stepIndex ? "assistant-dot-current" : "";
  return (
    <div className={`assistant-shell ${className ?? ""}`}>
      <div className="assistant-progress">
        {Array.from({ length: dotCount }, (_, index) => (
          <span key={index} className={`assistant-dot ${dotClass(index)}`} />
        ))}
      </div>
      <div className="assistant-prompt">{prompt}</div>
      <div className="assistant-input-area">{children}</div>
      {hint && <div className="hint">{hint}</div>}
      <div className="assistant-nav">
        {onBack ? (
          <button type="button" className="icon-button" onClick={onBack}>
            ← Back
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="icon-button" onClick={onSkip}>
          {skipLabel}
        </button>
      </div>
      {footer}
    </div>
  );
}
