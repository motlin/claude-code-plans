import { describe, expect, it } from "vite-plus/test";
import { handleUnknownApiRequest } from "../src/routes/api/$";

describe("unknown API route", () => {
  it("returns a structured JSON 404 response", async () => {
    const response = handleUnknownApiRequest();

    expect({
      body: await response.json(),
      contentType: response.headers.get("Content-Type"),
      status: response.status,
    }).toStrictEqual({
      body: { error: "API endpoint not found" },
      contentType: "application/json",
      status: 404,
    });
  });
});
