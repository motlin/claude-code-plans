import { describe, expect, it } from "vite-plus/test";
import { rejectCrossSite } from "../src/lib/same-origin-guard";

const REQUEST_URL = "http://localhost:7526/api/example";

function createRequest(headers?: HeadersInit): Request {
  return new Request(
    REQUEST_URL,
    headers === undefined ? { method: "POST" } : { headers, method: "POST" },
  );
}

async function describeResponse(response: Response | null): Promise<null | {
  body: string;
  headers: Record<string, string>;
  status: number;
  statusText: string;
}> {
  if (response === null) return null;

  return {
    body: await response.text(),
    headers: Object.fromEntries(response.headers),
    status: response.status,
    statusText: response.statusText,
  };
}

describe("rejectCrossSite", () => {
  it.each([
    { headers: undefined, name: "neither header" },
    { headers: { Origin: "http://localhost:7526" }, name: "only a matching Origin" },
    { headers: { "Sec-Fetch-Site": "same-origin" }, name: "only same-origin fetch metadata" },
    {
      headers: {
        Origin: "http://localhost:7526",
        "Sec-Fetch-Site": "same-origin",
      },
      name: "both matching headers",
    },
    {
      headers: {
        Host: "plans.m4.notlin.com",
        Origin: "https://plans.m4.notlin.com",
        "Sec-Fetch-Site": "same-origin",
      },
      name: "a matching public Host behind a TLS proxy",
    },
    {
      headers: {
        Host: "127.0.0.1:7526",
        Origin: "https://plans.m4.notlin.com",
        "Sec-Fetch-Site": "same-origin",
        "X-Forwarded-Host": "plans.m4.notlin.com, internal-proxy.example",
      },
      name: "the first matching forwarded Host behind nested proxies",
    },
  ])("allows $name", ({ headers }) => {
    expect(rejectCrossSite(createRequest(headers))).toBeNull();
  });

  it.each([
    { headers: { Origin: "https://evil.example" }, name: "only a mismatched Origin" },
    { headers: { "Sec-Fetch-Site": "cross-site" }, name: "only cross-site fetch metadata" },
    {
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "same-origin",
      },
      name: "a mismatched Origin with same-origin fetch metadata",
    },
    {
      headers: {
        Origin: "http://localhost:7526",
        "Sec-Fetch-Site": "cross-site",
      },
      name: "a matching Origin with cross-site fetch metadata",
    },
    {
      headers: {
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
      },
      name: "both cross-site headers",
    },
    {
      headers: {
        Host: "plans.m4.notlin.com",
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "same-origin",
      },
      name: "a foreign Origin with same-origin fetch metadata",
    },
    {
      headers: {
        Host: "127.0.0.1:7526",
        Origin: "https://plans.m4.notlin.com",
        "Sec-Fetch-Site": "same-origin",
        "X-Forwarded-Host": "other.example, plans.m4.notlin.com",
      },
      name: "a non-matching first forwarded Host",
    },
    {
      headers: {
        Host: "plans.m4.notlin.com",
        Origin: "not an origin",
        "Sec-Fetch-Site": "same-origin",
      },
      name: "a malformed Origin",
    },
  ])("returns the exact forbidden response for $name", async ({ headers }) => {
    expect(await describeResponse(rejectCrossSite(createRequest(headers)))).toStrictEqual({
      body: '{"error":"Forbidden"}',
      headers: { "content-type": "application/json" },
      status: 403,
      statusText: "",
    });
  });
});
