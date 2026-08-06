import { describe, expect, it } from "vite-plus/test";
import { diffRendererManifests } from "../scripts/screenshots";

describe("diffRendererManifests", () => {
  it("returns exact nested field paths for renderer drift", () => {
    const expected = {
      chromiumVersion: "100.0.0.0",
      viewport: { width: 1280, height: 718 },
      fontResolution: {
        sans: { requested: ["Alice Sans", "sans-serif"], resolved: "Alice Sans" },
      },
      fontsMissing: [],
    };
    const actual = {
      chromiumVersion: "101.0.0.0",
      viewport: { width: 1280, height: 720 },
      fontResolution: {
        sans: { requested: ["Alice Sans", "sans-serif"], resolved: "sans-serif" },
      },
      fontsMissing: ["Alice Sans"],
    };

    expect(diffRendererManifests(expected, actual)).toStrictEqual([
      "chromiumVersion",
      "fontResolution.sans.resolved",
      "fontsMissing",
      "viewport.height",
    ]);
  });

  it("returns no fields for identical manifests", () => {
    const manifest = {
      playwrightVersion: "1.0.0",
      platform: { operatingSystem: "fixture", architecture: "alice" },
    };

    expect(diffRendererManifests(manifest, structuredClone(manifest))).toStrictEqual([]);
  });
});
