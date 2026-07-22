// Thin React wrapper around the pure assistantFlowReducer (Task 3): exposes
// step-navigation state as a small hook interface so assistant components
// don't touch dispatch/action shapes directly.

import { useReducer, type Reducer } from "react";
import { assistantFlowReducer, initialFlowState } from "./assistantFlowReducer";
import type { FlowState, FlowAction } from "./assistantFlowReducer";

export interface AssistantFlow<TPhase> {
  phase: TPhase;
  stepIndex: number; // 0-based count of steps already completed in this flow
  canGoBack: boolean;
  advance(to: TPhase): void;
  back(): void;
}

export function useAssistantFlow<TPhase>(initialPhase: TPhase): AssistantFlow<TPhase> {
  const [state, dispatch] = useReducer<Reducer<FlowState<TPhase>, FlowAction<TPhase>>, TPhase>(
    assistantFlowReducer,
    initialPhase,
    initialFlowState,
  );
  return {
    phase: state.phase,
    stepIndex: state.history.length,
    canGoBack: state.history.length > 0,
    advance: (to: TPhase) => dispatch({ type: "advance", to }),
    back: () => dispatch({ type: "back" }),
  };
}
