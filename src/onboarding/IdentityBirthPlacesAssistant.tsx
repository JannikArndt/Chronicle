// Sub-project 1 of the onboarding-assistant initiative
// (docs/superpowers/specs/2026-07-22-onboarding-assistant-design.md):
// name -> birth year -> a chained loop of places lived, each with an
// optional "until" year. A blank "until" means "still living here" and
// ends the loop; "That's all for now" is always available as well.

import { useState } from "react";
import { AssistantStepShell } from "./AssistantStepShell";
import { PlaceAutocompleteInput } from "./PlaceAutocompleteInput";
import { useAssistantFlow } from "./useAssistantFlow";
import { addOnboardingPlaceEntry, completeIdentityStep, updatePerson } from "../state/actions";
import { parseDateInput } from "../model/fuzzyDate";

type Phase =
  | { kind: "name" }
  | { kind: "birthYear" }
  | { kind: "place"; iteration: number }
  | { kind: "until"; iteration: number };

interface IdentityBirthPlacesAssistantProps {
  onFinished: () => void;
}

export function IdentityBirthPlacesAssistant({ onFinished }: IdentityBirthPlacesAssistantProps) {
  const flow = useAssistantFlow<Phase>({ kind: "name" });
  const [name, setName] = useState("");
  const [birthYearText, setBirthYearText] = useState("");
  const [placeText, setPlaceText] = useState("");
  const [untilText, setUntilText] = useState("");
  const [setup, setSetup] = useState<{ personId: string; placesRowId: string } | null>(null);
  const [nextStartMs, setNextStartMs] = useState<number | null>(null);
  const [pendingPlaceLabel, setPendingPlaceLabel] = useState<string | null>(null);

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    const result = completeIdentityStep(trimmed);
    setSetup({ personId: result.personId, placesRowId: result.placesRowId });
    flow.advance({ kind: "birthYear" });
  };

  const commitBirthYear = () => {
    const parsed = parseDateInput(birthYearText.trim());
    if (!parsed) return;
    if (setup) updatePerson(setup.personId, { birthDate: parsed.ms });
    setNextStartMs(parsed.ms);
    flow.advance({ kind: "place", iteration: 1 });
  };

  const commitPlace = () => {
    const trimmed = placeText.trim();
    if (trimmed === "" || flow.phase.kind !== "place") return;
    setPendingPlaceLabel(trimmed);
    setPlaceText("");
    flow.advance({ kind: "until", iteration: flow.phase.iteration });
  };

  const commitUntil = () => {
    const trimmed = untilText.trim();
    const endParsed = trimmed === "" ? null : parseDateInput(trimmed);
    if (trimmed !== "" && !endParsed) return;
    if (!setup || nextStartMs === null || pendingPlaceLabel === null || flow.phase.kind !== "until") return;

    addOnboardingPlaceEntry(setup.placesRowId, {
      label: pendingPlaceLabel,
      startMs: nextStartMs,
      endMs: endParsed?.ms,
    });
    setUntilText("");
    const finishedIteration = flow.phase.iteration;
    setPendingPlaceLabel(null);

    if (!endParsed) {
      onFinished();
      return;
    }
    setNextStartMs(endParsed.ms);
    flow.advance({ kind: "place", iteration: finishedIteration + 1 });
  };

  switch (flow.phase.kind) {
    case "name":
      return (
        <AssistantStepShell prompt="What should we call your timeline?" stepIndex={flow.stepIndex} onSkip={onFinished}>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && commitName()}
            placeholder="Your name"
          />
          <button type="button" className="small-button" onClick={commitName}>
            Next →
          </button>
        </AssistantStepShell>
      );

    case "birthYear":
      return (
        <AssistantStepShell
          prompt="When were you born?"
          hint="Just the year is enough for now — you can fine-tune the exact month or day later."
          stepIndex={flow.stepIndex}
          onBack={flow.canGoBack ? flow.back : undefined}
          onSkip={onFinished}
        >
          <input
            autoFocus
            value={birthYearText}
            onChange={(event) => setBirthYearText(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && commitBirthYear()}
            placeholder="e.g. 1990"
            inputMode="numeric"
          />
          <button type="button" className="small-button" onClick={commitBirthYear}>
            Next →
          </button>
        </AssistantStepShell>
      );

    case "place":
      return (
        <AssistantStepShell
          prompt={flow.phase.iteration === 1 ? "Where were you born?" : "Where did you live next?"}
          hint="You can fine-tune the exact address later."
          stepIndex={flow.stepIndex}
          onBack={flow.canGoBack ? flow.back : undefined}
          onSkip={onFinished}
        >
          <PlaceAutocompleteInput value={placeText} onChange={setPlaceText} onSubmit={commitPlace} />
          <button type="button" className="small-button" onClick={commitPlace}>
            Next →
          </button>
          {flow.phase.iteration > 1 && (
            <button type="button" className="icon-button" onClick={onFinished}>
              That's all for now
            </button>
          )}
        </AssistantStepShell>
      );

    case "until":
      return (
        <AssistantStepShell
          prompt={`Until when did you live in ${pendingPlaceLabel ?? "this place"}?`}
          hint="Leave blank if you still live there. You can fine-tune the exact month or day later."
          stepIndex={flow.stepIndex}
          onBack={flow.canGoBack ? flow.back : undefined}
          onSkip={onFinished}
        >
          <input
            value={untilText}
            onChange={(event) => setUntilText(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && commitUntil()}
            placeholder="e.g. 2005, or leave blank"
            inputMode="numeric"
          />
          <button type="button" className="small-button" onClick={commitUntil}>
            {untilText.trim() === "" ? "Still living here →" : "Next →"}
          </button>
        </AssistantStepShell>
      );
  }
}
