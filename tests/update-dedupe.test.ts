import { describe, expect, it, vi, beforeEach, afterEach } from "vite-plus/test";
import { recentlyBroadcast, __testing } from "../src/lib/update-dedupe";

describe("recentlyBroadcast", () => {
  beforeEach(() => {
    __testing.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false on first call for a given key", () => {
    expect(recentlyBroadcast("plan:changed:foo.md:123", 500)).toBe(false);
  });

  it("returns true on a second call within the TTL window", () => {
    expect(recentlyBroadcast("plan:changed:foo.md:123", 500)).toBe(false);
    expect(recentlyBroadcast("plan:changed:foo.md:123", 500)).toBe(true);
  });

  it("returns false again once the TTL has elapsed", () => {
    expect(recentlyBroadcast("plan:changed:foo.md:123", 500)).toBe(false);
    vi.advanceTimersByTime(501);
    expect(recentlyBroadcast("plan:changed:foo.md:123", 500)).toBe(false);
  });

  it("treats different keys independently", () => {
    expect(recentlyBroadcast("plan:changed:foo.md:1", 500)).toBe(false);
    expect(recentlyBroadcast("plan:changed:foo.md:2", 500)).toBe(false);
    expect(recentlyBroadcast("plan:changed:foo.md:1", 500)).toBe(true);
    expect(recentlyBroadcast("plan:changed:foo.md:2", 500)).toBe(true);
  });

  it("returns true at the exact end of the TTL window", () => {
    expect(recentlyBroadcast("k", 500)).toBe(false);
    vi.advanceTimersByTime(499);
    expect(recentlyBroadcast("k", 500)).toBe(true);
  });

  it("honors a per-call TTL value", () => {
    expect(recentlyBroadcast("k", 100)).toBe(false);
    vi.advanceTimersByTime(50);
    expect(recentlyBroadcast("k", 100)).toBe(true);
    vi.advanceTimersByTime(60);
    expect(recentlyBroadcast("k", 100)).toBe(false);
  });

  it("does not refresh the timestamp on subsequent calls within the window", () => {
    // First call sets the timestamp at t=0
    expect(recentlyBroadcast("k", 500)).toBe(false);
    // Call at t=300 within window — returns true but does not refresh
    vi.advanceTimersByTime(300);
    expect(recentlyBroadcast("k", 500)).toBe(true);
    // At t=600 the original timestamp has expired; treated as a new event
    vi.advanceTimersByTime(300);
    expect(recentlyBroadcast("k", 500)).toBe(false);
  });
});
