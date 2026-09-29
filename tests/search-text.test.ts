import { describe, expect, it } from "vite-plus/test";
import { relativeBucket, trimSnippet } from "../src/lib/search-text";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function local(month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  return new Date(2026, month - 1, day, hour, minute, second, ms).getTime();
}

describe("relativeBucket", () => {
  const now = local(9, 29, 12);

  it.each([
    ["the same instant", now, "Just now"],
    ["a future mtime", now + MINUTE, "Just now"],
    ["just under 5 minutes", now - 5 * MINUTE + 1, "Just now"],
    ["exactly 5 minutes", now - 5 * MINUTE, "Past hour"],
    ["just under an hour", now - HOUR + 1, "Past hour"],
    ["exactly an hour", now - HOUR, "Today"],
    ["local midnight today", local(9, 29), "Today"],
    ["just before midnight", local(9, 28, 23, 59, 59, 999), "Yesterday"],
    ["local midnight yesterday", local(9, 28), "Yesterday"],
    ["just before yesterday", local(9, 27, 23, 59, 59, 999), "Past week"],
    ["just under 7 days", now - 7 * DAY + 1, "Past week"],
    ["exactly 7 days", now - 7 * DAY, "Past month"],
    ["just under 30 days", now - 30 * DAY + 1, "Past month"],
    ["exactly 30 days", now - 30 * DAY, "Past year"],
    ["just under 365 days", now - 365 * DAY + 1, "Past year"],
    ["exactly 365 days", now - 365 * DAY, null],
    ["several years", now - 3 * 365 * DAY, null],
  ])("buckets %s", (_label, mtime, expected) => {
    expect(relativeBucket(mtime, now)).toBe(expected);
  });

  it("prefers the minute and hour buckets across midnight", () => {
    expect({
      threeMinutes: relativeBucket(local(9, 28, 23, 59), local(9, 29, 0, 2)),
      fortyMinutes: relativeBucket(local(9, 28, 23, 50), local(9, 29, 0, 30)),
      ninetyMinutes: relativeBucket(local(9, 28, 23), local(9, 29, 0, 30)),
      twoDaysAgoAtNight: relativeBucket(local(9, 27, 23, 50), local(9, 29, 0, 30)),
    }).toStrictEqual({
      threeMinutes: "Just now",
      fortyMinutes: "Past hour",
      ninetyMinutes: "Yesterday",
      twoDaysAgoAtNight: "Past week",
    });
  });
});

function matchOf(text: string, needle: string, from = 0) {
  const start = text.indexOf(needle, from);
  return { start, end: start + needle.length };
}

describe("trimSnippet", () => {
  it.each([
    {
      label: "upstream's Tailscale case",
      text: "…Tailscale (probably your easiest path)** Since…",
      needle: "Tailscale",
      expected: { text: "Tailscale (probably your easiest", matches: [{ start: 0, end: 9 }] },
    },
    {
      label: "one word before and three after",
      text: "so we should use tailscale for this remote access today",
      needle: "tailscale",
      expected: { text: "use tailscale for this remote", matches: [{ start: 4, end: 13 }] },
    },
    {
      label: "a match at the start",
      text: "tailscale works",
      needle: "tailscale",
      expected: { text: "tailscale works", matches: [{ start: 0, end: 9 }] },
    },
    {
      label: "a match at the end",
      text: "please configure the tailscale",
      needle: "tailscale",
      expected: { text: "the tailscale", matches: [{ start: 4, end: 13 }] },
    },
    {
      label: "a before-word longer than 12 chars",
      text: "internationalization tailscale",
      needle: "tailscale",
      expected: { text: "onalization tailscale", matches: [{ start: 12, end: 21 }] },
    },
    {
      label: "after-words stopping at the 24-char cap",
      text: "tailscale extraordinarily comprehensive setup",
      needle: "tailscale",
      expected: { text: "tailscale extraordinarily", matches: [{ start: 0, end: 9 }] },
    },
    {
      label: "CJK characters counting double",
      text: "请问我们应该使用Tailscale来访问远程服务器然后再连接数据库",
      needle: "Tailscale",
      expected: {
        text: "我们应该使用Tailscale来访问远程服务器然后再连",
        matches: [{ start: 6, end: 15 }],
      },
    },
    {
      label: "newlines and markdown emphasis",
      text: "Use **tailscale**\n\nfor _remote_ access",
      needle: "tailscale",
      expected: { text: "Use tailscale for remote access", matches: [{ start: 4, end: 13 }] },
    },
    {
      label: "underscores inside identifiers",
      text: "tailscale my_var here",
      needle: "tailscale",
      expected: { text: "tailscale my_var here", matches: [{ start: 0, end: 9 }] },
    },
    {
      label: "a trailing ellipsis",
      text: "see tailscale docs...",
      needle: "tailscale",
      expected: { text: "see tailscale docs", matches: [{ start: 4, end: 13 }] },
    },
  ])("windows $label", ({ text, needle, expected }) => {
    expect(trimSnippet(text, [matchOf(text, needle)])).toStrictEqual(expected);
  });

  it("windows around the first match and keeps later matches inside the window", () => {
    const text = "later tailscale and tailscale again later today, tailscale";
    const matches = [
      matchOf(text, "tailscale", 40),
      matchOf(text, "tailscale", 10),
      matchOf(text, "tailscale"),
    ];
    expect(trimSnippet(text, matches)).toStrictEqual({
      text: "later tailscale and tailscale again",
      matches: [
        { start: 6, end: 15 },
        { start: 20, end: 29 },
      ],
    });
  });

  it("returns the cleaned text when there are no matches", () => {
    expect(trimSnippet("…some **bold**\nsnippet…", [])).toStrictEqual({
      text: "some bold snippet",
      matches: [],
    });
  });
});
