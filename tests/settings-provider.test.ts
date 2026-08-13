import {
  DEFAULTS,
  VERBOSITY_KEYS,
  VERBOSITY_PRESETS,
  detectVerbosity,
  type Settings,
  type Verbosity,
} from "../src/components/settings-provider";

describe("settings-provider", () => {
  // Pins the preset key set against upstream-parity churn. Settled on
  // 2026-08-12 by capturing the missing Normal-view specimen from the same
  // claude.ai/code session and same 12 turns as the 2026-08-10 verbose dumps:
  // .llm/ui-sync/upstream/code-rich-normal.tree.json next to
  // code-rich-verbose.tree.json. Row counts across those 12 turns:
  //   verbose  112 tool rows + 10 group rows + 42 thinking blocks
  //   normal    14 tool rows + 26 group rows +  0 thinking blocks
  // So upstream's Normal view gates exactly one kind of content, thinking,
  // which normal already gates via showThinking:false. It does not drop tool
  // rows -- it merges consecutive calls into denser cross-tool group rows
  // ("Ran 3 commands, updated todos", "Read and edited cache.ts, searched
  // code") that stay expandable, whereas Verbose groups only same-tool runs
  // ("Read 3 files"). That is a grouping-density difference in the renderer,
  // not a per-row visibility flag, so no per-row gating may be added to
  // VERBOSITY_PRESETS on the strength of these dumps.
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
