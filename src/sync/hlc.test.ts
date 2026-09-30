import { describe, expect, test } from "vitest";
import { compareHlc, formatHlc, localTick, parseHlc, receiveTick } from "./hlc";

describe("hlc serialisation", () => {
  test("round-trips", () => {
    const hlc = { wall: 1_700_000_000_000, counter: 7, node: "acct-a" };
    expect(parseHlc(formatHlc(hlc))).toEqual(hlc);
  });

  test("survives a node id containing colons", () => {
    const hlc = { wall: 1, counter: 0, node: "a:b:c" };
    expect(parseHlc(formatHlc(hlc)).node).toBe("a:b:c");
  });

  test("string order matches numeric order — the point of the padding", () => {
    const small = formatHlc({ wall: 9, counter: 0, node: "a" });
    const large = formatHlc({ wall: 10, counter: 0, node: "a" });
    expect(compareHlc(small, large)).toBe(-1);
    expect([large, small].sort()).toEqual([small, large]);
  });

  test("the counter breaks ties within one millisecond", () => {
    const first = formatHlc({ wall: 5, counter: 0, node: "a" });
    const second = formatHlc({ wall: 5, counter: 1, node: "a" });
    expect(compareHlc(first, second)).toBe(-1);
  });

  test("the node breaks ties between two devices at the same instant", () => {
    const a = formatHlc({ wall: 5, counter: 0, node: "acct-a" });
    const b = formatHlc({ wall: 5, counter: 0, node: "acct-b" });
    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(a, a)).toBe(0);
  });
});

describe("localTick", () => {
  test("follows the wall clock when it advances", () => {
    expect(localTick({ wall: 100, counter: 3, node: "a" }, 200, "a")).toEqual({ wall: 200, counter: 0, node: "a" });
  });

  test("advances the counter when the wall clock has not moved", () => {
    expect(localTick({ wall: 100, counter: 3, node: "a" }, 100, "a")).toEqual({ wall: 100, counter: 4, node: "a" });
  });

  // The regression this guards: an NTP correction that moves the clock
  // backwards used to let a later edit be stamped earlier and lose to the edit
  // it came after.
  test("never goes backwards when the wall clock does", () => {
    const next = localTick({ wall: 1000, counter: 0, node: "a" }, 400, "a");
    expect(next.wall).toBe(1000);
    expect(next.counter).toBe(1);
  });

  test("starts from zero with no previous clock", () => {
    expect(localTick(undefined, 50, "a")).toEqual({ wall: 50, counter: 0, node: "a" });
  });

  test("the counter saturates instead of wrapping", () => {
    const saturated = localTick({ wall: 10, counter: 99_999, node: "a" }, 10, "a");
    expect(saturated.counter).toBe(99_999);
  });
});

describe("receiveTick", () => {
  // The H in HLC: a peer whose clock is ahead drags ours forward, so an edit we
  // make after reading theirs sorts after theirs.
  test("adopts a remote clock that is ahead of ours", () => {
    const next = receiveTick({ wall: 100, counter: 0, node: "a" }, { wall: 500, counter: 2, node: "b" }, 100, "a");
    expect(next.wall).toBe(500);
    expect(next.counter).toBe(3);
  });

  test("keeps our own clock when it is ahead of the remote one", () => {
    const next = receiveTick({ wall: 900, counter: 4, node: "a" }, { wall: 100, counter: 0, node: "b" }, 100, "a");
    expect(next).toEqual({ wall: 900, counter: 5, node: "a" });
  });

  test("takes the counter past both when the two clocks agree", () => {
    const next = receiveTick({ wall: 300, counter: 2, node: "a" }, { wall: 300, counter: 9, node: "b" }, 300, "a");
    expect(next).toEqual({ wall: 300, counter: 10, node: "a" });
  });

  test("resets the counter when real time has moved past both", () => {
    const next = receiveTick({ wall: 100, counter: 5, node: "a" }, { wall: 200, counter: 5, node: "b" }, 900, "a");
    expect(next).toEqual({ wall: 900, counter: 0, node: "a" });
  });

  test("an edit made after receiving a remote edit always sorts after it", () => {
    const remote = { wall: 5_000, counter: 0, node: "b" };
    const afterReceive = receiveTick({ wall: 10, counter: 0, node: "a" }, remote, 20, "a");
    const ourEdit = localTick(afterReceive, 20, "a");
    expect(compareHlc(formatHlc(ourEdit), formatHlc(remote))).toBe(1);
  });
});
