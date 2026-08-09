import { describe, expect, it } from "vite-plus/test";
import { validateSearchParameters } from "../src/routes/search";

describe("search route mode parameter validation", () => {
  it("passes each valid mode through unchanged", () => {
    expect({
      titles: validateSearchParameters({ q: "hook", mode: "titles" }),
      conversations: validateSearchParameters({ q: "hook", mode: "conversations" }),
      files: validateSearchParameters({ q: "hook", mode: "files" }),
    }).toStrictEqual({
      titles: { q: "hook", mode: "titles" },
      conversations: { q: "hook", mode: "conversations" },
      files: { q: "hook", mode: "files" },
    });
  });

  it("accepts messages as an alias for conversations", () => {
    expect(validateSearchParameters({ q: "hook", mode: "messages" })).toStrictEqual({
      q: "hook",
      mode: "conversations",
    });
  });

  it("defaults to titles when mode is absent", () => {
    expect(validateSearchParameters({})).toStrictEqual({ q: "", mode: "titles" });
  });

  it("throws on an unknown mode instead of silently coercing it", () => {
    expect(() => validateSearchParameters({ q: "hook", mode: "bogus" })).toThrowError(
      'Unknown search mode "bogus": expected titles, conversations, files, or messages',
    );
  });
});
