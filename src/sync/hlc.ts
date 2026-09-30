// Hybrid logical clock — plans/sharing-feature-design.md §D4.
//
// Wall-clock time alone cannot order edits from two devices: phone clocks drift
// by seconds, so the device that is behind loses every race it should have won,
// and an edit made later can be stamped earlier. An HLC keeps a wall-clock
// component (so timestamps stay human-meaningful and roughly track real time)
// but never goes backwards, and breaks ties with a counter and the account id.
//
// Serialised fixed-width so plain string comparison IS the total order — the
// same string sorts correctly in Postgres, in a Map key, and in JS.

export interface Hlc {
  wall: number; // ms since epoch, UTC (this codebase has no other kind)
  counter: number;
  node: string; // account id — the final tiebreaker, so the order is total
}

const WALL_DIGITS = 15; // 13 today; 15 lasts to the year 33658
const COUNTER_DIGITS = 5;

// Guards against a machine whose clock is set to the far future poisoning every
// later timestamp: the counter is what absorbs a stalled or reversed clock, and
// it must not silently wrap.
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1;

export function formatHlc(hlc: Hlc): string {
  return `${String(hlc.wall).padStart(WALL_DIGITS, "0")}:${String(hlc.counter).padStart(COUNTER_DIGITS, "0")}:${hlc.node}`;
}

export function parseHlc(serialised: string): Hlc {
  const [wall, counter, ...node] = serialised.split(":");
  return { wall: Number(wall), counter: Number(counter), node: node.join(":") };
}

// Fixed-width padding is what makes this correct — without it "9:0:a" would
// sort after "10:0:a".
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// A local edit. The clock never moves backwards: if the wall clock has not
// advanced since the last event (or has gone backwards, which happens on NTP
// correction), the counter advances instead.
export function localTick(previous: Hlc | undefined, wallNow: number, node: string): Hlc {
  const previousWall = previous?.wall ?? 0;
  if (wallNow > previousWall) return { wall: wallNow, counter: 0, node };
  return { wall: previousWall, counter: clampCounter((previous?.counter ?? 0) + 1), node };
}

// Receiving a remote event drags our clock forward past it, which is the whole
// point of the H in HLC: causality survives even when the sender's wall clock
// is ahead of ours.
export function receiveTick(previous: Hlc | undefined, remote: Hlc, wallNow: number, node: string): Hlc {
  const previousWall = previous?.wall ?? 0;
  const wall = Math.max(previousWall, remote.wall, wallNow);
  if (wall === previousWall && wall === remote.wall) {
    return { wall, counter: clampCounter(Math.max(previous?.counter ?? 0, remote.counter) + 1), node };
  }
  if (wall === previousWall) return { wall, counter: clampCounter((previous?.counter ?? 0) + 1), node };
  if (wall === remote.wall) return { wall, counter: clampCounter(remote.counter + 1), node };
  return { wall, counter: 0, node };
}

// Overflow would wrap the counter to zero and silently reorder edits. Pinning
// it instead degrades to "these two edits tie, the node id decides", which is
// wrong-ish but stable — and it takes 100k events in a single millisecond to
// get here, which means something is broken upstream anyway.
function clampCounter(counter: number): number {
  return Math.min(counter, MAX_COUNTER);
}
