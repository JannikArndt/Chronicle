// Auto-trigger predicate for the onboarding overlay: only for a genuinely
// fresh dataset. Never re-triggers once either the identity step has
// completed (selfGroupId set) or the user has built something manually.

import type { TimelineDataset } from "../model/types";

export function shouldShowOnboarding(dataset: TimelineDataset): boolean {
  return dataset.selfGroupId === undefined && dataset.groups.length === 0;
}
