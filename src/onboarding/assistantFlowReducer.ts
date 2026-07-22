// Pure step-navigation state for an onboarding assistant: a stack of
// previously-visited phases so "back" always returns exactly where the user
// came from, including through a variable-length loop (e.g. repeated
// "place" / "until" steps whose count isn't known in advance).

export interface FlowState<TPhase> {
  phase: TPhase;
  history: TPhase[];
}

export type FlowAction<TPhase> = { type: "advance"; to: TPhase } | { type: "back" };

export function initialFlowState<TPhase>(phase: TPhase): FlowState<TPhase> {
  return { phase, history: [] };
}

export function assistantFlowReducer<TPhase>(
  state: FlowState<TPhase>,
  action: FlowAction<TPhase>,
): FlowState<TPhase> {
  if (action.type === "advance") {
    return { phase: action.to, history: [...state.history, state.phase] };
  }
  if (state.history.length === 0) return state;
  const history = state.history.slice(0, -1);
  return { phase: state.history[state.history.length - 1], history };
}
