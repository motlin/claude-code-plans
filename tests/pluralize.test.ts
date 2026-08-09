import { describe, expect, it } from "vite-plus/test";
import { formatCount, pluralize } from "../src/lib/pluralize";

describe("pluralize", () => {
  it("returns the singular form for a count of 1", () => {
    expect(pluralize(1, "session")).toBe("session");
    expect(pluralize(1, "plan")).toBe("plan");
    expect(pluralize(1, "msg")).toBe("msg");
  });

  it("returns the plural form for counts other than 1", () => {
    expect(pluralize(0, "session")).toBe("sessions");
    expect(pluralize(2, "session")).toBe("sessions");
    expect(pluralize(100, "task")).toBe("tasks");
  });

  it("pluralizes consonant-y nouns with -ies", () => {
    expect(pluralize(1, "memory")).toBe("memory");
    expect(pluralize(2, "memory")).toBe("memories");
  });

  it("does not apply -ies to vowel-y nouns", () => {
    expect(pluralize(2, "day")).toBe("days");
  });

  it("uses an explicit plural override when given", () => {
    expect(pluralize(1, "match", "matches")).toBe("match");
    expect(pluralize(2, "match", "matches")).toBe("matches");
  });
});

describe("formatCount", () => {
  it("prefixes the count", () => {
    expect(formatCount(1, "session")).toBe("1 session");
    expect(formatCount(2, "session")).toBe("2 sessions");
    expect(formatCount(0, "plan")).toBe("0 plans");
    expect(formatCount(1, "memory")).toBe("1 memory");
    expect(formatCount(3, "memory")).toBe("3 memories");
  });
});
