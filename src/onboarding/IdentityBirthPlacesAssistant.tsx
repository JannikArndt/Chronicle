// Sub-project 1 of the onboarding-assistant initiative
// (docs/superpowers/specs/2026-07-22-onboarding-assistant-design.md):
// name -> birth date -> first place lived + its year (each its own step) ->
// a live-editable table of every place after that (PlacesTable). The table
// exists because a step-per-place wizard punishes the very human habit of
// "thinking about where I lived next reminds me of something about an
// earlier place" — so past the first place, editing replaces re-answering.

import { useState } from "react";
import { AssistantStepShell } from "./AssistantStepShell";
import { BirthDateInput } from "./BirthDateInput";
import { PlaceAutocompleteInput } from "./PlaceAutocompleteInput";
import { PlacesTable } from "./PlacesTable";
import type { PlaceAnswer } from "./PlacesTable";
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
  | { kind: "place" }
  | { kind: "until" }
  | { kind: "places"; firstRow: { entryId: string; place: PlaceAnswer; yearText: string } };

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
  const [firstPlaceAnswer, setFirstPlaceAnswer] = useState<PlaceAnswer | null>(null);
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
    flow.advance({ kind: "place" });
  };

  const commitPlace = () => {
    const trimmed = placeText.trim();
    if (trimmed === "") return;
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
    setFirstPlaceAnswer(answer);
    setSelectedSuggestion(null);
    setPlaceText("");
    flow.advance({ kind: "until" });
  };

  const commitUntil = () => {
    const trimmed = untilText.trim();
    const endParsed = trimmed === "" ? null : parseDateInput(trimmed);
    if (trimmed !== "" && !endParsed) return;
    if (!setup || birthDateMs === undefined || firstPlaceAnswer === null) return;

    const entryId = addOnboardingPlaceEntry(setup.placesRowId, {
      label: firstPlaceAnswer.title,
      startMs: birthDateMs,
      endMs: endParsed?.ms,
      subtitle: firstPlaceAnswer.subtitle,
      fullName: firstPlaceAnswer.fullName,
      coordinates: firstPlaceAnswer.coordinates,
      street: firstPlaceAnswer.street,
      city: firstPlaceAnswer.city,
      country: firstPlaceAnswer.country,
    });
    setUntilText("");

    if (!endParsed) {
      // No year given: this reads as "still living there" only once the
      // user explicitly finishes (see PlacesTable) — but there's no table to
      // finish from yet if the very first place has no entry to seed it
      // with. Treat a blank year on the very first place as done for now,
      // same as the rest of the app treats an ongoing entry: nothing further
      // to enter until the user comes back and adds a move.
      onFinished();
      return;
    }
    flow.advance({ kind: "places", firstRow: { entryId, place: firstPlaceAnswer, yearText: trimmed } });
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
          prompt="Where did you live first?"
          stepIndex={flow.stepIndex}
          onBack={flow.canGoBack ? flow.back : undefined}
          onSkip={onFinished}
        >
          <PlaceAutocompleteInput
            value={placeText}
            onChange={(text) => {
              setPlaceText(text);
              setSelectedSuggestion((prev) => (prev && text !== formatSuggestionText(prev) ? null : prev));
            }}
            onSubmit={commitPlace}
            onSelect={(suggestion) => setSelectedSuggestion(suggestion)}
          />
          <button type="button" className="small-button" onClick={commitPlace}>
            Next →
          </button>
        </AssistantStepShell>
      );

    case "until":
      return (
        <AssistantStepShell
          prompt={`Until when did you live in ${firstPlaceAnswer?.title ?? "this place"}?`}
          hint="Leave blank if you still live there. You can fine-tune the exact month or day later."
          stepIndex={flow.stepIndex}
          onBack={flow.canGoBack ? flow.back : undefined}
          onSkip={onFinished}
        >
          <input
            autoFocus
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

    case "places":
      return (
        <AssistantStepShell
          prompt="Where else have you lived?"
          hint="Press Tab to move between fields. Edit any row any time — Enter or Finish when you're done."
          stepIndex={flow.stepIndex}
          onSkip={onFinished}
        >
          <PlacesTable
            placesRowId={setup!.placesRowId}
            birthDateMs={birthDateMs!}
            firstRow={flow.phase.firstRow}
            onFinished={onFinished}
          />
        </AssistantStepShell>
      );
  }
}
