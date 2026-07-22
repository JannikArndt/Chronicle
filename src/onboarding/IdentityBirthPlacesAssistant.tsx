// Sub-project 1 of the onboarding-assistant initiative
// (docs/superpowers/specs/2026-07-22-onboarding-assistant-design.md):
// name -> birth year -> a chained loop of places lived, each with an
// optional "until" year. A blank "until" means "still living here" and
// ends the loop; "That's all for now" is always available as well.

import { useState } from "react";
import { AssistantStepShell } from "./AssistantStepShell";
import { PlaceAutocompleteInput } from "./PlaceAutocompleteInput";
import { useAssistantFlow } from "./useAssistantFlow";
import { addOnboardingPlaceEntry, completeIdentityStep, updateGroup, updatePerson } from "../state/actions";
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
  const [setup, setSetup] = useState<{ personId: string; groupId: string; placesRowId: string } | null>(null);
  const [startMsByIteration, setStartMsByIteration] = useState<Record<number, number>>({});
  const [placeLabelByIteration, setPlaceLabelByIteration] = useState<Record<number, string>>({});

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    if (setup) {
      // Resubmitting after Back-ing to "name": relabel the already-committed
      // person/group instead of calling completeIdentityStep again, which
      // would create a second Person + Group + "Places lived" row and orphan
      // the first one.
      updatePerson(setup.personId, { label: trimmed });
      updateGroup(setup.groupId, { label: trimmed });
    } else {
      const result = completeIdentityStep(trimmed);
      setSetup({ personId: result.personId, groupId: result.groupId, placesRowId: result.placesRowId });
    }
    flow.advance({ kind: "birthYear" });
  };

  const commitBirthYear = () => {
    const parsed = parseDateInput(birthYearText.trim());
    if (!parsed) return;
    if (setup) updatePerson(setup.personId, { birthDate: parsed.ms });
    setStartMsByIteration((prev) => ({ ...prev, 1: parsed.ms }));
    flow.advance({ kind: "place", iteration: 1 });
  };

  const commitPlace = () => {
    const trimmed = placeText.trim();
    if (trimmed === "" || flow.phase.kind !== "place") return;
    const iteration = flow.phase.iteration;
    setPlaceLabelByIteration((prev) => ({ ...prev, [iteration]: trimmed }));
    setPlaceText("");
    flow.advance({ kind: "until", iteration });
  };

  const commitUntil = () => {
    const trimmed = untilText.trim();
    const endParsed = trimmed === "" ? null : parseDateInput(trimmed);
    if (trimmed !== "" && !endParsed) return;
    if (flow.phase.kind !== "until") return;
    const iteration = flow.phase.iteration;
    const startMs = startMsByIteration[iteration];
    const label = placeLabelByIteration[iteration];
    if (!setup || startMs === undefined || label === undefined) return;

    addOnboardingPlaceEntry(setup.placesRowId, {
      label,
      startMs,
      endMs: endParsed?.ms,
    });
    setUntilText("");

    if (!endParsed) {
      onFinished();
      return;
    }
    setStartMsByIteration((prev) => ({ ...prev, [iteration + 1]: endParsed.ms }));
    flow.advance({ kind: "place", iteration: iteration + 1 });
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
          // Reaching place{N>1} means iteration N-1's entry was already
          // committed to the dataset (commitUntil only advances here after a
          // successful write). Going back from there would re-enter until{N-1}
          // and, on resubmit, collide with the still-present committed entry
          // (same start ms -> planEntryInsert reports a conflict, which
          // addOnboardingPlaceEntry silently no-ops on). Back from place{1}
          // is safe: no place entries exist yet.
          onBack={flow.canGoBack && flow.phase.iteration === 1 ? flow.back : undefined}
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
          prompt={`Until when did you live in ${placeLabelByIteration[flow.phase.iteration] ?? "this place"}?`}
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
