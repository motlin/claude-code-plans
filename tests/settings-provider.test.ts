import {
  DEFAULTS,
  VERBOSITY_KEYS,
  VERBOSITY_PRESETS,
  detectVerbosity,
  type Settings,
  type Verbosity,
} from "../src/components/settings-provider";

describe("settings-provider", () => {
  // Pins the preset key set against upstream-parity churn. The 2026-08-10
  // claude.ai/code captures in .llm/ui-sync/upstream/ are ALL view:"verbose"
  // (code-rich-verbose.tree.json, code-rich-verbose.styles.json and
  // code-rich-exemplars.json each declare it), so they cannot show which rows
  // upstream hides in its Normal view. The verbose dump also still contains 10
  // expanded tool-group rows, so Verbose demonstrably does not flatten
  // grouping. Until a matching Normal-view specimen is captured, no per-row
  // gating may be added to VERBOSITY_PRESETS on the strength of those dumps.
  describe("VERBOSITY_PRESETS", () => {
    it("gates exactly the eight content keys, with no per-row gating added", () => {
      expect(VERBOSITY_KEYS).toEqual([
        "showTools",
        "showThinking",
        "showPassedHooks",
        "showHookWarnings",
        "showHookErrors",
        "showSystemBanners",
        "showCompactSummaries",
        "showTranscriptOnly",
      ]);
    });

    it("keeps every preset on the same key set", () => {
      for (const verbosity of ["normal", "thinking", "verbose"] satisfies Verbosity[]) {
        expect(Object.keys(VERBOSITY_PRESETS[verbosity])).toEqual(VERBOSITY_KEYS);
      }
    });

    it("keeps the normal preset unchanged", () => {
      expect(VERBOSITY_PRESETS.normal).toEqual({
        showTools: true,
        showThinking: false,
        showPassedHooks: false,
        showHookWarnings: true,
        showHookErrors: true,
        showSystemBanners: false,
        showCompactSummaries: false,
        showTranscriptOnly: false,
      });
    });

    it("keeps the thinking preset unchanged", () => {
      expect(VERBOSITY_PRESETS.thinking).toEqual({
        showTools: true,
        showThinking: true,
        showPassedHooks: false,
        showHookWarnings: true,
        showHookErrors: true,
        showSystemBanners: false,
        showCompactSummaries: false,
        showTranscriptOnly: false,
      });
    });

    it("keeps the verbose preset unchanged", () => {
      expect(VERBOSITY_PRESETS.verbose).toEqual({
        showTools: true,
        showThinking: true,
        showPassedHooks: true,
        showHookWarnings: true,
        showHookErrors: true,
        showSystemBanners: true,
        showCompactSummaries: true,
        showTranscriptOnly: true,
      });
    });

    it("defaults to the normal preset", () => {
      for (const key of VERBOSITY_KEYS) {
        expect(DEFAULTS[key]).toEqual(VERBOSITY_PRESETS.normal[key]);
      }
    });
  });

  describe("VERBOSITY_KEYS", () => {
    it("does not include showDebug", () => {
      expect(VERBOSITY_KEYS).not.toContain("showDebug");
    });

    it("includes the expected content-related keys", () => {
      expect(VERBOSITY_KEYS).toContain("showTools");
      expect(VERBOSITY_KEYS).toContain("showThinking");
      expect(VERBOSITY_KEYS).toContain("showPassedHooks");
      expect(VERBOSITY_KEYS).toContain("showHookWarnings");
      expect(VERBOSITY_KEYS).toContain("showHookErrors");
      expect(VERBOSITY_KEYS).toContain("showSystemBanners");
      expect(VERBOSITY_KEYS).toContain("showCompactSummaries");
      expect(VERBOSITY_KEYS).toContain("showTranscriptOnly");
    });
  });

  describe("detectVerbosity", () => {
    it("detects normal verbosity with default settings", () => {
      expect(detectVerbosity(DEFAULTS)).toBe("normal");
    });

    it("detects normal verbosity when showDebug is true", () => {
      const settings: Settings = { ...DEFAULTS, showDebug: true };
      expect(detectVerbosity(settings)).toBe("normal");
    });

    it("detects thinking verbosity", () => {
      const settings: Settings = {
        ...DEFAULTS,
        showTools: true,
        showThinking: true,
        showPassedHooks: false,
        showHookWarnings: true,
        showHookErrors: true,
        showSystemBanners: false,
      };
      expect(detectVerbosity(settings)).toBe("thinking");
    });

    it("detects thinking verbosity even when showDebug is true", () => {
      const settings: Settings = {
        ...DEFAULTS,
        showTools: true,
        showThinking: true,
        showPassedHooks: false,
        showHookWarnings: true,
        showHookErrors: true,
        showSystemBanners: false,
        showDebug: true,
      };
      expect(detectVerbosity(settings)).toBe("thinking");
    });

    it("does not detect removed minimal preset", () => {
      const settings: Settings = {
        ...DEFAULTS,
        showTools: false,
        showThinking: false,
        showPassedHooks: false,
        showHookWarnings: false,
        showHookErrors: false,
        showSystemBanners: false,
        verbosity: "normal",
      };
      expect(detectVerbosity(settings)).toBe("normal");
    });

    it("detects verbose verbosity", () => {
      const settings: Settings = {
        ...DEFAULTS,
        showTools: true,
        showThinking: true,
        showPassedHooks: true,
        showHookWarnings: true,
        showHookErrors: true,
        showSystemBanners: true,
        showCompactSummaries: true,
        showTranscriptOnly: true,
      };
      expect(detectVerbosity(settings)).toBe("verbose");
    });

    it("detects verbose verbosity even when showDebug is true", () => {
      const settings: Settings = {
        ...DEFAULTS,
        showTools: true,
        showThinking: true,
        showPassedHooks: true,
        showHookWarnings: true,
        showHookErrors: true,
        showSystemBanners: true,
        showCompactSummaries: true,
        showTranscriptOnly: true,
        showDebug: true,
      };
      expect(detectVerbosity(settings)).toBe("verbose");
    });

    it("does NOT detect verbose when showCompactSummaries is false", () => {
      const settings: Settings = {
        ...DEFAULTS,
        showTools: true,
        showThinking: true,
        showPassedHooks: true,
        showHookWarnings: true,
        showHookErrors: true,
        showSystemBanners: true,
        showCompactSummaries: false,
        showTranscriptOnly: true,
      };
      expect(detectVerbosity(settings)).not.toBe("verbose");
    });

    it("does NOT detect verbose when showTranscriptOnly is false", () => {
      const settings: Settings = {
        ...DEFAULTS,
        showTools: true,
        showThinking: true,
        showPassedHooks: true,
        showHookWarnings: true,
        showHookErrors: true,
        showSystemBanners: true,
        showCompactSummaries: true,
        showTranscriptOnly: false,
      };
      expect(detectVerbosity(settings)).not.toBe("verbose");
    });

    it("falls back to saved verbosity when showCompactSummaries deviates from normal preset", () => {
      // settings.verbosity ('normal') is returned as a fallback because no
      // preset matches exactly; that's distinct from "this matches normal".
      const settings: Settings = {
        ...DEFAULTS,
        showCompactSummaries: true,
        verbosity: "verbose",
      };
      expect(detectVerbosity(settings)).toBe("verbose");
    });

    it("falls back to saved verbosity when showTranscriptOnly deviates from normal preset", () => {
      const settings: Settings = {
        ...DEFAULTS,
        showTranscriptOnly: true,
        verbosity: "verbose",
      };
      expect(detectVerbosity(settings)).toBe("verbose");
    });

    it("does NOT detect thinking when showCompactSummaries is true", () => {
      const settings: Settings = {
        ...DEFAULTS,
        showTools: true,
        showThinking: true,
        showPassedHooks: false,
        showHookWarnings: true,
        showHookErrors: true,
        showSystemBanners: false,
        showCompactSummaries: true,
        showTranscriptOnly: false,
      };
      expect(detectVerbosity(settings)).not.toBe("thinking");
    });

    it("does NOT detect thinking when showTranscriptOnly is true", () => {
      const settings: Settings = {
        ...DEFAULTS,
        showTools: true,
        showThinking: true,
        showPassedHooks: false,
        showHookWarnings: true,
        showHookErrors: true,
        showSystemBanners: false,
        showCompactSummaries: false,
        showTranscriptOnly: true,
      };
      expect(detectVerbosity(settings)).not.toBe("thinking");
    });
  });
});
