// The first-run assistant (plans/onboarding-questionnaire.md): the anchors
// that make every later entry line up — when you were born, where you lived,
// learned and worked, who you were with, your kids and grandkids — one topic
// per screen, in the same order at every age, with a live preview of the
// result at the foot of each screen.
//
//   name → born → lived → learned → worked → partner → kids → grandkids → canvas
//
// Each screen edits a draft and writes nothing until Next or Skip, which
// reconcile it with the dataset (`firstRunRecords.ts`). Because drafts are
// loaded from — and reconciled into — the saved records, Back may cross a
// commit: going back to a committed screen shows what was saved and updates it
// in place. A draft left by Back without committing is kept in memory, so
// nothing typed is lost on the way.

import { useEffect, useMemo, useState } from "react";
import { AgeFigure } from "./AgeFigure";
import { AssistantStepShell } from "./AssistantStepShell";
import { GrandkidsEditor, KidsEditor } from "./FamilyEditors";
import { OnboardingPreview } from "./OnboardingPreview";
import { SequenceEditor } from "./SequenceEditor";
import {
  ageSpan,
  clampBirthYear,
  exactAge,
  MAX_AGE,
  MONTH_NAMES,
  monthNote,
  yearAge,
} from "./birthYear";
import type { BirthAnswer } from "./birthYear";
import { loadFamily } from "./familyRecords";
import type { FamilyDraft } from "./familyRecords";
import {
  commitBirth,
  commitFamily,
  commitTopic,
  findSelfGroup,
  lifeRange,
  loadTopic,
  storedBirth,
} from "./firstRunRecords";
import { KIDS_COLOR, TOPIC_ORDER, TOPICS } from "./lifeTopics";
import type { TopicId } from "./lifeTopics";
import { previewLanes } from "./previewLayout";
import { rebaseSequence } from "./sequence";
import type { Sequence } from "./sequence";
import type { SequenceLoad } from "./sequenceRecords";
import { useAssistantFlow } from "./useAssistantFlow";
import { completeIdentityStep, updateGroup } from "../state/actions";
import { appStore, useAppState } from "../state/store";

type Phase =
  | { kind: "name" }
  | { kind: "born" }
  | { kind: "topic"; topic: TopicId }
  | { kind: "kids" }
  | { kind: "grandkids" };

interface BornDraft {
  answer: BirthAnswer;
  monthOpen: boolean;
  touched: boolean;
}

interface TopicDraft {
  sequence: Sequence;
  birthYear: number; // the year its ages were counted from
}

export interface LifeRange {
  startMs: number;
  endMs: number;
}

interface OnboardingAssistantProps {
  // With a range when the flow ran to the end: the canvas frames birth → now.
  onFinished: (range?: LifeRange) => void;
}

const UNREPRESENTABLE: Record<"overlap" | "unrepresentable", string> = {
  overlap: "This timeline has overlapping entries — edit it on the canvas.",
  unrepresentable: "This timeline has entries this editor can't show — edit it on the canvas.",
};

function stepIndexOf(phase: Phase): number {
  switch (phase.kind) {
    case "name":
      return 0;
    case "born":
      return 1;
    case "topic":
      return 2 + TOPIC_ORDER.indexOf(phase.topic);
    case "kids":
      return 6;
    case "grandkids":
      return 7;
  }
}

// On phones the on-screen keyboard takes half the screen; the preview gives
// way while it is open so the field being typed in stays visible.
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport || !window.matchMedia("(pointer: coarse)").matches) return;
    const check = () => setOpen(viewport.height < window.innerHeight - 150);
    viewport.addEventListener("resize", check);
    return () => viewport.removeEventListener("resize", check);
  }, []);
  return open;
}

export function OnboardingAssistant({ onFinished }: OnboardingAssistantProps) {
  const [nowMs] = useState(() => Date.now());
  const nowYear = new Date(nowMs).getUTCFullYear();
  const dataset = useAppState((s) => s.dataset);
  const flow = useAssistantFlow<Phase>({ kind: "name" });
  const keyboardOpen = useKeyboardOpen();

  const [name, setName] = useState(() => findSelfGroup(appStore.getState().dataset)?.label ?? "");
  const [bornDraft, setBornDraft] = useState<BornDraft | undefined>(undefined);
  const [topicDrafts, setTopicDrafts] = useState<Partial<Record<TopicId, TopicDraft>>>({});
  const [familyDraft, setFamilyDraft] = useState<FamilyDraft | undefined>(undefined);
  const [noKids, setNoKids] = useState(false);
  const [noGrandkids, setNoGrandkids] = useState(false);

  const stored = storedBirth(dataset, nowMs);
  const born: BornDraft = bornDraft ?? {
    answer: stored.answer,
    monthOpen: stored.answer.month !== null,
    touched: false,
  };
  const birthYear = born.answer.year;
  const age = Math.max(0, yearAge(birthYear, nowMs));
  const span = ageSpan(birthYear, nowMs);

  // A screen's draft is loaded once per visit — new item keys on every render
  // would remount every row under the finger.
  const phase = flow.phase;
  const entryLoads = useMemo(() => {
    const loads: Partial<Record<TopicId, SequenceLoad>> = {};
    if (phase.kind === "topic") loads[phase.topic] = loadTopic(appStore.getState().dataset, TOPICS[phase.topic], birthYear, age);
    return loads;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);
  const entryFamily = useMemo(() => loadFamily(appStore.getState().dataset), [phase]);

  const topicLoad = (id: TopicId, forPreview: boolean): SequenceLoad => {
    const draft = topicDrafts[id];
    const topic = TOPICS[id];
    if (draft) return { ok: true, sequence: rebaseSequence(draft.sequence, topic.rules, draft.birthYear, birthYear, age) };
    if (!forPreview && entryLoads[id]) return entryLoads[id]!;
    return loadTopic(dataset, topic, birthYear, age);
  };
  const family = familyDraft ?? entryFamily;
  const hasKids = family.kids.length > 0;
  const totalSteps = hasKids ? 8 : 7;

  const preview = keyboardOpen ? null : (
    <OnboardingPreview
      birthYear={birthYear}
      span={span}
      lanes={previewLanes(
        TOPIC_ORDER.map((id) => {
          const load = topicLoad(id, phase.kind !== "topic" || phase.topic !== id);
          return {
            icon: TOPICS[id].icon,
            color: TOPICS[id].color,
            sequence: load.ok ? load.sequence : { items: [], end: null },
            always: id === "lived",
          };
        }),
        family,
        birthYear,
        KIDS_COLOR,
      )}
    />
  );

  const finish = () => onFinished(lifeRange(birthYear, nowMs));

  // ---------- commits ----------

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    // Replaying, or Back to this step: relabel the group that is already
    // there. Calling completeIdentityStep again would create a second group
    // and "Places lived" row and orphan the first.
    const self = findSelfGroup(appStore.getState().dataset);
    if (self) updateGroup(self.id, { label: trimmed });
    else completeIdentityStep(trimmed);
    flow.advance({ kind: "born" });
  };

  const leaveBorn = (confirmed: boolean) => {
    // An untouched slider is a default, not an answer: Skip leaves no birth
    // date behind. "That's me" confirms whatever is shown.
    if (confirmed || born.touched || stored.stored !== undefined) commitBirth(born.answer);
    setBornDraft(undefined);
    flow.advance({ kind: "topic", topic: "lived" });
  };

  const leaveTopic = (id: TopicId) => {
    const load = topicLoad(id, false);
    if (load.ok) commitTopic(TOPICS[id], load.sequence, birthYear);
    setTopicDrafts((drafts) => ({ ...drafts, [id]: undefined }));
    const next = TOPIC_ORDER[TOPIC_ORDER.indexOf(id) + 1];
    flow.advance(next ? { kind: "topic", topic: next } : { kind: "kids" });
  };

  const leaveFamily = (from: "kids" | "grandkids") => {
    commitFamily(family);
    setFamilyDraft(undefined);
    if (from === "kids" && family.kids.length > 0) flow.advance({ kind: "grandkids" });
    else finish();
  };

  const nav = {
    stepIndex: stepIndexOf(phase),
    totalSteps,
    onBack: flow.canGoBack ? flow.back : undefined,
    className: "onboarding-shell",
  };

  // ---------- screens ----------

  switch (phase.kind) {
    case "name":
      return (
        <AssistantStepShell prompt="What should we call your timeline?" {...nav} onSkip={() => onFinished()}>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && commitName()}
            placeholder="Your name"
          />
          <button type="button" className="onboarding-go" onClick={commitName}>
            Next →
          </button>
        </AssistantStepShell>
      );

    case "born": {
      const update = (patch: Partial<BornDraft>) => setBornDraft({ ...born, ...patch, touched: true });
      const setYear = (year: number) => update({ answer: { ...born.answer, year: clampBirthYear(year, nowMs) } });
      const shownAge = exactAge(born.answer, nowMs);
      return (
        <AssistantStepShell prompt="When were you born?" {...nav} onSkip={() => leaveBorn(false)}>
          <p className="onboarding-hint">The year is enough for now.</p>
          <AgeFigure age={shownAge} />
          <div className="born-readout">
            <span className="born-age">{shownAge}</span>
            <span className="born-unit">years old</span>
          </div>
          <div className="born-row">
            <button type="button" className="born-nudge" aria-label="One year earlier" onClick={() => setYear(birthYear - 1)}>
              ‹
            </button>
            <span className="born-year">
              born {born.answer.month !== null ? `${MONTH_NAMES[born.answer.month]} ` : ""}
              {birthYear}
            </span>
            <button type="button" className="born-nudge" aria-label="One year later" onClick={() => setYear(birthYear + 1)}>
              ›
            </button>
          </div>
          <input
            type="range"
            className="born-slider"
            min={0}
            max={MAX_AGE}
            value={age}
            aria-label="Age"
            onChange={(event) => setYear(nowYear - Number(event.target.value))}
          />
          <div className="born-month">
            {!born.monthOpen && born.answer.month === null ? (
              <button type="button" className="onboarding-link" onClick={() => setBornDraft({ ...born, monthOpen: true })}>
                Birthday still to come this year? ＋ Add month
              </button>
            ) : (
              <>
                <div className="born-months" role="radiogroup" aria-label="Birth month">
                  {MONTH_NAMES.map((month, index) => (
                    <button
                      key={month}
                      type="button"
                      className={`born-month-pill ${born.answer.month === index ? "born-month-pill-active" : ""}`}
                      aria-pressed={born.answer.month === index}
                      onClick={() =>
                        update({ answer: { ...born.answer, month: born.answer.month === index ? null : index } })
                      }
                    >
                      {month}
                    </button>
                  ))}
                </div>
                <div className="born-month-note">{monthNote(born.answer, nowMs)}</div>
              </>
            )}
          </div>
          <button type="button" className="onboarding-go" onClick={() => leaveBorn(true)}>
            That's me →
          </button>
        </AssistantStepShell>
      );
    }

    case "topic": {
      const id = phase.topic;
      const topic = TOPICS[id];
      const load = topicLoad(id, false);
      return (
        <AssistantStepShell prompt={topic.prompt} {...nav} onSkip={() => leaveTopic(id)} footer={preview}>
          <p className="onboarding-hint">{topic.hint}</p>
          {load.ok ? (
            <SequenceEditor
              key={id}
              topic={topic}
              sequence={load.sequence}
              onChange={(sequence) => setTopicDrafts((drafts) => ({ ...drafts, [id]: { sequence, birthYear } }))}
              birthYear={birthYear}
              age={age}
              span={span}
            />
          ) : (
            <div className="onboarding-note">{UNREPRESENTABLE[load.reason]}</div>
          )}
          <button type="button" className="onboarding-go" onClick={() => leaveTopic(id)}>
            Next →
          </button>
        </AssistantStepShell>
      );
    }

    case "kids":
      return (
        <AssistantStepShell prompt="Do you have kids?" {...nav} onSkip={() => leaveFamily("kids")} footer={preview}>
          <p className="onboarding-hint">Name and birth year. More family can come later.</p>
          <KidsEditor
            draft={family}
            onChange={(next) => {
              setFamilyDraft(next);
              if (next.kids.length > 0) setNoKids(false);
            }}
            birthYear={birthYear}
            nowYear={nowYear}
            noKids={noKids}
            onNoKids={() => {
              setFamilyDraft({ kids: [], grandkids: [] });
              setNoKids(true);
            }}
          />
          <button type="button" className="onboarding-go" onClick={() => leaveFamily("kids")}>
            {hasKids ? "Next →" : "Draw my timeline →"}
          </button>
        </AssistantStepShell>
      );

    case "grandkids":
      return (
        <AssistantStepShell prompt="Any grandchildren?" {...nav} onSkip={() => leaveFamily("grandkids")} footer={preview}>
          <p className="onboarding-hint">Pick whose child, then name and year.</p>
          <GrandkidsEditor
            draft={family}
            onChange={(next) => {
              setFamilyDraft(next);
              if (next.grandkids.length > 0) setNoGrandkids(false);
            }}
            nowYear={nowYear}
            none={noGrandkids}
            onNone={() => {
              setFamilyDraft({ ...family, grandkids: [] });
              setNoGrandkids(true);
            }}
          />
          <button type="button" className="onboarding-go" onClick={() => leaveFamily("grandkids")}>
            Draw my timeline →
          </button>
        </AssistantStepShell>
      );
  }
}
