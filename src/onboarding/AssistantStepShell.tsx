// Shared presentational shell for every onboarding-assistant step: one
// prompt, one input area, growing progress dots, back/skip navigation.
// This is the single piece of visual/interaction consistency shared across
// assistants — no generic step-definition/runner abstraction on top of it.

import type { ReactNode } from "react";

interface AssistantStepShellProps {
  prompt: string;
  hint?: string;
  stepIndex: number; // 0-based count of steps already completed in this flow
  onBack?: () => void;
  onSkip: () => void;
  skipLabel?: string; // defaults to "Skip for now" — override when a step has a more accurate label for ending early (e.g. "That's all for now")
  children: ReactNode;
}

export function AssistantStepShell({
  prompt,
  hint,
  stepIndex,
  onBack,
  onSkip,
  skipLabel = "Skip for now",
  children,
}: AssistantStepShellProps) {
  const dotCount = stepIndex + 1;
  return (
    <div className="assistant-shell">
      <div className="assistant-progress">
        {Array.from({ length: dotCount }, (_, index) => (
          <span
            key={index}
            className={`assistant-dot ${index < dotCount - 1 ? "assistant-dot-done" : "assistant-dot-current"}`}
          />
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
    </div>
  );
}
