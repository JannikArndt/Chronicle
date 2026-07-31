// Which shell to render. Deliberately a live media query rather than a one-shot
// read: rotating a phone must move the app between the two shells, and the
// anchors of every sheet are derived from the viewport height.

import { useSyncExternalStore } from "react";

// Matches the breakpoint the old rail media query used. Width only, on purpose:
// `pointer: coarse` also matches touch-screen laptops and iPads in landscape,
// where the desktop shell is the better surface.
const MOBILE_MEDIA_QUERY = "(max-width: 640px)";

function subscribeToMediaQuery(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(MOBILE_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readIsMobile(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeToMediaQuery, readIsMobile, () => false);
}

function subscribeToViewportResize(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

// Sheet anchors are fractions of the screen, so they have to be recomputed when
// the URL bar collapses or the phone is rotated.
export function useViewportHeight(): number {
  return useSyncExternalStore(
    subscribeToViewportResize,
    () => (typeof window === "undefined" ? 0 : window.innerHeight),
    () => 0,
  );
}
