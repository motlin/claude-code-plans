import { describe, expect, it } from "vite-plus/test";
import {
  parsePageList,
  parseConsoleMessage,
  parseNetworkRequest,
} from "../src/components/tool-renderers/chrome-devtools-renderer";

describe("parsePageList", () => {
  it("parses a single page", () => {
    const result = parsePageList("0: https://example.com");
    expect(result).toStrictEqual([{ index: 0, url: "https://example.com", selected: false }]);
  });

  it("parses multiple pages with selected indicator", () => {
    const text = `0: https://example.com [selected]
1: https://other.com
2: about:blank`;
    const result = parsePageList(text);
    expect(result).toStrictEqual([
      { index: 0, url: "https://example.com", selected: true },
      { index: 1, url: "https://other.com", selected: false },
      { index: 2, url: "about:blank", selected: false },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parsePageList("")).toStrictEqual([]);
  });

  it("skips lines that do not match the format", () => {
    const text = `Some header text
0: https://example.com
not a page line`;
    const result = parsePageList(text);
    expect(result).toStrictEqual([{ index: 0, url: "https://example.com", selected: false }]);
  });
});

describe("parseConsoleMessage", () => {
  it("parses a basic log message", () => {
    const result = parseConsoleMessage("msgid=1 [log] Hello world");
    expect(result).toStrictEqual({
      msgid: "1",
      level: "log",
      message: "Hello world",
    });
  });

  it("parses a message with arg count", () => {
    const result = parseConsoleMessage("msgid=5 [error] TypeError: undefined (3 args)");
    expect(result).toStrictEqual({
      msgid: "5",
      level: "error",
      message: "TypeError: undefined",
      argCount: 3,
    });
  });

  it("parses a message with single arg", () => {
    const result = parseConsoleMessage("msgid=2 [warn] something bad (1 arg)");
    expect(result).toStrictEqual({
      msgid: "2",
      level: "warn",
      message: "something bad",
      argCount: 1,
    });
  });

  it("returns null for non-matching input", () => {
    expect(parseConsoleMessage("not a console message")).toBe(null);
  });

  it("returns null for empty string", () => {
    expect(parseConsoleMessage("")).toBe(null);
  });
});

describe("parseNetworkRequest", () => {
  it("parses a GET request with status code", () => {
    const result = parseNetworkRequest("reqid=92 GET http://127.0.0.1:3000/api [failed - 500]");
    expect(result).toStrictEqual({
      reqid: "92",
      method: "GET",
      url: "http://127.0.0.1:3000/api",
      status: "failed",
      statusCode: 500,
    });
  });

  it("parses a POST request without status code", () => {
    const result = parseNetworkRequest("reqid=10 POST https://api.example.com/data [success]");
    expect(result).toStrictEqual({
      reqid: "10",
      method: "POST",
      url: "https://api.example.com/data",
      status: "success",
    });
  });

  it("parses various HTTP methods", () => {
    for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) {
      const result = parseNetworkRequest(`reqid=1 ${method} http://localhost/x [success - 200]`);
      expect(result?.method).toBe(method);
    }
  });

  it("returns null for non-matching input", () => {
    expect(parseNetworkRequest("not a network request")).toBe(null);
  });

  it("returns null for empty string", () => {
    expect(parseNetworkRequest("")).toBe(null);
  });

  it("parses redirect status codes", () => {
    const result = parseNetworkRequest("reqid=5 GET http://example.com [redirect - 301]");
    expect(result).toStrictEqual({
      reqid: "5",
      method: "GET",
      url: "http://example.com",
      status: "redirect",
      statusCode: 301,
    });
  });
});
