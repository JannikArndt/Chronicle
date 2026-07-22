import { describe, expect, test } from "vitest";
import { assistantFlowReducer, initialFlowState } from "./assistantFlowReducer";

type Phase = { kind: "a" } | { kind: "b" } | { kind: "c" };

describe("assistantFlowReducer", () => {
  test("advance pushes the current phase onto history and moves to the new phase", () => {
    const state = initialFlowState<Phase>({ kind: "a" });
    const next = assistantFlowReducer(state, { type: "advance", to: { kind: "b" } });
    expect(next.phase).toEqual({ kind: "b" });
    expect(next.history).toEqual([{ kind: "a" }]);
  });

  test("back returns to the previous phase and pops history", () => {
    let state = initialFlowState<Phase>({ kind: "a" });
    state = assistantFlowReducer(state, { type: "advance", to: { kind: "b" } });
    state = assistantFlowReducer(state, { type: "advance", to: { kind: "c" } });
    const back = assistantFlowReducer(state, { type: "back" });
    expect(back.phase).toEqual({ kind: "b" });
    expect(back.history).toEqual([{ kind: "a" }]);
  });

  test("back is a no-op at the start of the flow", () => {
    const state = initialFlowState<Phase>({ kind: "a" });
    const back = assistantFlowReducer(state, { type: "back" });
    expect(back).toEqual(state);
  });
});
