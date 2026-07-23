// Sub-project 1 of the onboarding-assistant initiative
// (docs/superpowers/specs/2026-07-22-onboarding-assistant-design.md):
// name -> birth year -> a chained loop of places lived, each with an
// optional "until" year. A blank "until" means "still living here" and
// ends the loop; "That's all for now" is always available as well.

import { useState } from "react";
import { AssistantStepShell } from "./AssistantStepShell";
import { BirthDateInput } from "./BirthDateInput";
import { PlaceAutocompleteInput } from "./PlaceAutocompleteInput";
import { formatSuggestionText } from "./nominatim";
import { useAssistantFlow } from "./useAssistantFlow";
import { addOnboardingPlaceEntry, completeIdentityStep, updateGroup, updatePerson } from "../state/actions";
import { parseDateInput } from "../model/fuzzyDate";
import { appStore } from "../state/store";

// Manually re-opening the assistant (e.g. from the rail's "+" menu, for
// testing) on a dataset that already has a selfPersonId must resume that
// identity rather than call completeIdentityStep again — otherwise commitName
// would create a second Person/Group/"Places lived" row and reassign
// selfPersonId, orphaning the original (the same class of bug the Back-across-
// commit-boundary fix above guards against, but on fresh mount instead).
function findExistingSetup(): { personId: string; groupId: string; placesRowId: string } | null {
  const dataset = appStore.getState().dataset;
  if (!dataset.selfPersonId) return null;
  const group = dataset.groups.find((g) => g.personId === dataset.selfPersonId);
  if (!group) return null;
  const placesRow = dataset.rows.find((r) => r.groupId === group.id && r.label === "Places lived");
  if (!placesRow) return null;
  return { personId: dataset.selfPersonId, groupId: group.id, placesRowId: placesRow.id };
}

type Phase =
  | { kind: "name" }
  | { kind: "birthYear" }
  | { kind: "place"; iteration: number }
  | { kind: "until"; iteration: number };

interface PlaceAnswer {
  title: string;
  subtitle?: string;
  fullName: string;
  coordinates?: { lat: number; lon: number };
  street?: string;
  city?: string;
  country?: string;
}

interface IdentityBirthPlacesAssistantProps {
  onFinished: () => void;
}

export function IdentityBirthPlacesAssistant({ onFinished }: IdentityBirthPlacesAssistantProps) {
  const flow = useAssistantFlow<Phase>({ kind: "name" });
  const [setup, setSetup] = useState<{ personId: string; groupId: string; placesRowId: string } | null>(
    findExistingSetup,
  );
  const [name, setName] = useState(() => {
    const dataset = appStore.getState().dataset;
    const person = setup && dataset.people.find((p) => p.id === setup.personId);
    return person?.label ?? "";
  });
  const [birthDateMs, setBirthDateMs] = useState<number | undefined>(() => {
    const dataset = appStore.getState().dataset;
    const person = setup && dataset.people.find((p) => p.id === setup.personId);
    return person?.birthDate;
  });
  const [placeText, setPlaceText] = useState("");
  const [untilText, setUntilText] = useState("");
  const [startMsByIteration, setStartMsByIteration] = useState<Record<number, number>>({});
  const [placeAnswerByIteration, setPlaceAnswerByIteration] = useState<Record<number, PlaceAnswer>>({});
  const [selectedSuggestion, setSelectedSuggestion] = useState<import("./nominatim").PlaceSuggestion | null>(null);

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

  const commitBirthDate = () => {
    if (birthDateMs === undefined) return;
    if (setup) updatePerson(setup.personId, { birthDate: birthDateMs });
    setStartMsByIteration((prev) => ({ ...prev, 1: birthDateMs }));
    flow.advance({ kind: "place", iteration: 1 });
  };

  const commitPlace = () => {
    const trimmed = placeText.trim();
    if (trimmed === "" || flow.phase.kind !== "place") return;
    const iteration = flow.phase.iteration;
    const answer: PlaceAnswer =
      selectedSuggestion && formatSuggestionText(selectedSuggestion) === trimmed
        ? {
            title: selectedSuggestion.title,
            subtitle: selectedSuggestion.subtitle,
            fullName: selectedSuggestion.fullName,
            coordinates: { lat: Number(selectedSuggestion.lat), lon: Number(selectedSuggestion.lon) },
            street: selectedSuggestion.street,
            city: selectedSuggestion.city,
            country: selectedSuggestion.country,
          }
        : { title: trimmed, subtitle: undefined, fullName: trimmed, coordinates: undefined };
    setPlaceAnswerByIteration((prev) => ({ ...prev, [iteration]: answer }));
    setSelectedSuggestion(null);
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
    const place = placeAnswerByIteration[iteration];
    if (!setup || startMs === undefined || place === undefined) return;

    addOnboardingPlaceEntry(setup.placesRowId, {
      label: place.title,
      startMs,
      endMs: endParsed?.ms,
      subtitle: place.subtitle,
      fullName: place.fullName,
      coordinates: place.coordinates,
      street: place.street,
      city: place.city,
      country: place.country,
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
          hint="This is used to compute your age on your timeline."
          stepIndex={flow.stepIndex}
          onBack={flow.canGoBack ? flow.back : undefined}
          onSkip={onFinished}
        >
          <BirthDateInput value={birthDateMs} onChange={setBirthDateMs} onSubmit={commitBirthDate} />
          <button type="button" className="small-button" onClick={commitBirthDate}>
            Next →
          </button>
        </AssistantStepShell>
      );

    case "place":
      return (
        <AssistantStepShell
          prompt={flow.phase.iteration === 1 ? "Where did you live first?" : "Where did you live next?"}
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
          <PlaceAutocompleteInput
            value={placeText}
            onChange={(text) => {
              setPlaceText(text);
              if (selectedSuggestion && text !== formatSuggestionText(selectedSuggestion)) setSelectedSuggestion(null);
            }}
            onSubmit={commitPlace}
            onSelect={(suggestion) => setSelectedSuggestion(suggestion)}
          />
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
          prompt={`Until when did you live in ${placeAnswerByIteration[flow.phase.iteration]?.title ?? "this place"}?`}
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
