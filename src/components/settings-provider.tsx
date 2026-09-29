import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { z } from "zod";

import { ACTIVE_SESSION_WINDOW_MS } from "../lib/active-session-window";
import {
  DEFAULT_CAPABILITIES,
  PersistedCapabilitiesSchema,
  type PersistedCapabilities,
} from "../lib/capabilities";
import {
  DEFAULT_SESSION_LIST_PREFS,
  migrateSessionListPrefs,
  type SessionListPrefs,
} from "../lib/session-groups";
import {
  codeFontFamily,
  CodeThemeDarkSchema,
  CodeThemeLightSchema,
  DEFAULT_CODE_THEMES,
  type CodeThemeDark,
  type CodeThemeLight,
} from "../lib/code-themes";
import { TranscriptWidthSchema, type TranscriptWidth } from "../lib/transcript-width";
import {
  appearanceCssVars,
  InterfaceFontSchema,
  TranscriptTextSizeSchema,
  type InterfaceFont,
  type TranscriptTextSize,
} from "../lib/appearance";

type SubagentView = "tree" | "gantt" | "sequence";

/** The Changes pane's diff layout: one column, or old and new side by side. */
export const DiffStyleSchema = z.enum(["unified", "split"]);
export type DiffStyle = z.infer<typeof DiffStyleSchema>;
export type Verbosity = "normal" | "thinking" | "verbose";

/** Upstream General ▸ Appearance ▸ Motion: follow the OS, or always reduce. */
const MotionSchema = z.enum(["system", "reduced"]);
export type Motion = z.infer<typeof MotionSchema>;

export interface LinkCategoryRule {
  label: string;
  hostPattern: string;
}

export interface Settings {
  showThinking: boolean;
  showTools: boolean;
  showDebug: boolean;
  showToolDuration: boolean;

  showPassedHooks: boolean;
  showHookWarnings: boolean;
  showHookErrors: boolean;

  showSystemBanners: boolean;
  showCompactSummaries: boolean;
  showTranscriptOnly: boolean;

  defaultSubagentView: SubagentView;

  chromeHidden: boolean;
  statusFooterVisible: boolean;
  /** "reduced" sets `html[data-motion=reduced]`, which stops pulses and transitions. */
  motion: Motion;
  /** The transcript and composer column measure: 768, 960 or 1280px. */
  transcriptWidth: TranscriptWidth;
  /** Interface font: the bundled sans, or the OS UI font via `--font-sans` on <html>. */
  interfaceFont: InterfaceFont;
  /** Transcript body text size, set as `--transcript-text-size` on <html>. */
  transcriptTextSize: TranscriptTextSize;
  /** Local-only "Recent plans" and "Memories updated" home sections; off matches claude.ai/code. */
  homeShowLocalSections: boolean;
  /** Shiki theme for code in light mode. */
  codeThemeLight: CodeThemeLight;
  /** Shiki theme for code in dark mode. */
  codeThemeDark: CodeThemeDark;
  /** Custom monospace font family for code and terminal; empty keeps the built-in stack. */
  codeFont: string;

  showSummaryButton: boolean;
  // ccp preferences are browser-local; /api/settings reflects Claude's own files and is read-only.
  capabilities: PersistedCapabilities;

  activeTimeoutSec: number;

  sessionSort: "urgency" | "stable";

  /** How /sessions organizes its list. "project" matches the sidebar's tree. */
  sessionsGrouping: "project" | "time";

  /** The sidebar session list's Filter & group menu choices. */
  sessionListPrefs: SessionListPrefs;

  /** Desktop notification when a session finishes and needs review (upstream "Response completions"). */
  notifyCompletions: boolean;
  /** Desktop notification when a session waits on the user (upstream "Code permission requests"). */
  notifyPermissionRequests: boolean;

  verbosity: Verbosity;

  linkCategoryRules: LinkCategoryRule[];

  // The Changes pane's ⋯ menu, defaulting like claude.ai/code.
  diffShowTree: boolean;
  diffGroupByFolder: boolean;
  diffGroupByKind: boolean;
  diffStyle: DiffStyle;
  diffWordWrap: boolean;
  diffWordDiff: boolean;
  diffHideWhitespace: boolean;

  // The Files pane's ⋯ menu.
  filesHideIgnored: boolean;
  /** A single click opens an italic preview tab; off pins every open, like upstream's setting. */
  filesPreviewTabs: boolean;
  /** The Files pane's tree column width in pixels, clamped to 160–640 where it is used. */
  filesTreeWidth: number;
  /** Source view word wrap, on by default like upstream. */
  filesWordWrap: boolean;
  /** Source view tab width: 2, 4 or 8, normalized where it is used. */
  filesTabSize: number;
}

export const DEFAULTS: Settings = {
  showThinking: false,
  showTools: true,
  showDebug: false,
  showToolDuration: true,

  showPassedHooks: false,
  showHookWarnings: true,
  showHookErrors: true,

  showSystemBanners: false,
  showCompactSummaries: false,
  showTranscriptOnly: false,

  defaultSubagentView: "tree",

  chromeHidden: false,
  statusFooterVisible: true,
  motion: "system",
  transcriptWidth: "narrow",
  interfaceFont: "sans",
  transcriptTextSize: "md",
  homeShowLocalSections: false,
  codeThemeLight: DEFAULT_CODE_THEMES.light,
  codeThemeDark: DEFAULT_CODE_THEMES.dark,
  codeFont: "",

  showSummaryButton: true,
  capabilities: DEFAULT_CAPABILITIES,

  activeTimeoutSec: ACTIVE_SESSION_WINDOW_MS / 1000,

  sessionSort: "urgency",

  sessionsGrouping: "project",

  sessionListPrefs: DEFAULT_SESSION_LIST_PREFS,

  notifyCompletions: true,
  notifyPermissionRequests: false,

  verbosity: "normal",

  linkCategoryRules: [],

  diffShowTree: false,
  diffGroupByFolder: true,
  diffGroupByKind: false,
  diffStyle: "unified",
  diffWordWrap: true,
  diffWordDiff: true,
  diffHideWhitespace: false,

  filesHideIgnored: false,
  filesPreviewTabs: true,
  filesTreeWidth: 240,
  filesWordWrap: true,
  filesTabSize: 4,
};

const STORAGE_KEYS: Record<keyof Settings, string> = {
  showThinking: "ccp-show-thinking",
  showTools: "ccp-show-tools",
  showDebug: "ccp-show-debug",
  showToolDuration: "ccp-show-tool-duration",
  showPassedHooks: "ccp-show-passed-hooks",
  showHookWarnings: "ccp-show-hook-warnings",
  showHookErrors: "ccp-show-hook-errors",
  showSystemBanners: "ccp-show-system-banners",
  showCompactSummaries: "ccp-show-compact-summaries",
  showTranscriptOnly: "ccp-show-transcript-only",
  defaultSubagentView: "ccp-subagent-view",
  chromeHidden: "ccp-chrome-hidden",
  statusFooterVisible: "ccp-status-footer",
  motion: "ccp-motion",
  transcriptWidth: "ccp-transcript-width",
  interfaceFont: "ccp-interface-font",
  transcriptTextSize: "ccp-transcript-text-size",
  homeShowLocalSections: "ccp-home-show-local-sections",
  codeThemeLight: "ccp-code-theme-light",
  codeThemeDark: "ccp-code-theme-dark",
  codeFont: "ccp-code-font",
  showSummaryButton: "ccp-show-summary-button",
  capabilities: "ccp-capabilities",
  activeTimeoutSec: "ccp-active-timeout",
  sessionSort: "ccp-session-sort",
  sessionsGrouping: "ccp-sessions-grouping",
  sessionListPrefs: "ccp-session-list-prefs",
  notifyCompletions: "ccp-notify-completions",
  notifyPermissionRequests: "ccp-notify-permission-requests",
  verbosity: "ccp-verbosity",
  linkCategoryRules: "ccp-link-category-rules",
  diffShowTree: "ccp-diff-show-tree",
  diffGroupByFolder: "ccp-diff-group-by-folder",
  diffGroupByKind: "ccp-diff-group-by-kind",
  diffStyle: "ccp-diff-style",
  diffWordWrap: "ccp-diff-word-wrap",
  diffWordDiff: "ccp-diff-word-diff",
  diffHideWhitespace: "ccp-diff-hide-whitespace",
  filesHideIgnored: "ccp-files-hide-ignored",
  filesPreviewTabs: "ccp-files-preview-tabs",
  filesTreeWidth: "ccp-files-tree-width",
  filesWordWrap: "ccp-files-word-wrap",
  filesTabSize: "ccp-files-tab-size",
};

/** The localStorage key a setting persists under. */
export function settingStorageKey(key: keyof Settings): string {
  return STORAGE_KEYS[key];
}

const LEGACY_DESKTOP_NOTIFICATIONS_KEY = "ccp-desktop-notifications";

/**
 * Splits the old single desktop-notifications toggle into the two upstream
 * kinds: its stored value carries over to both, unless a new key already exists.
 */
export function migrateLegacyNotificationSetting(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): void {
  const legacy = storage.getItem(LEGACY_DESKTOP_NOTIFICATIONS_KEY);
  if (legacy === null) return;
  const value = legacy === "true" ? "true" : "false";
  for (const key of ["notifyCompletions", "notifyPermissionRequests"] as const) {
    if (storage.getItem(STORAGE_KEYS[key]) === null) storage.setItem(STORAGE_KEYS[key], value);
  }
  storage.removeItem(LEGACY_DESKTOP_NOTIFICATIONS_KEY);
}

const LINK_CATEGORY_RULES_SCHEMA = z.array(
  z
    .object({
      label: z.string(),
      hostPattern: z.string(),
    })
    .strict(),
);
// Presets gate whole content categories, never individual tool rows. The
// 2026-08-10 claude.ai/code captures are all view:"verbose", so they carry no
// evidence about upstream's Normal view; adding per-row gating here needs a
// Normal-view specimen to diff against first.
export const VERBOSITY_PRESETS: Record<Verbosity, Partial<Settings>> = {
  normal: {
    showTools: true,
    showThinking: false,
    showPassedHooks: false,
    showHookWarnings: true,
    showHookErrors: true,
    showSystemBanners: false,
    showCompactSummaries: false,
    showTranscriptOnly: false,
  },
  thinking: {
    showTools: true,
    showThinking: true,
    showPassedHooks: false,
    showHookWarnings: true,
    showHookErrors: true,
    showSystemBanners: false,
    showCompactSummaries: false,
    showTranscriptOnly: false,
  },
  verbose: {
    showTools: true,
    showThinking: true,
    showPassedHooks: true,
    showHookWarnings: true,
    showHookErrors: true,
    showSystemBanners: true,
    showCompactSummaries: true,
    showTranscriptOnly: true,
  },
};

export const VERBOSITY_KEYS = Object.keys(VERBOSITY_PRESETS.normal) as Array<keyof Settings>;

/** The preset the transcript toggles match, or null when they have been customized. */
export function matchedVerbosityPreset(settings: Settings): Verbosity | null {
  for (const preset of ["normal", "thinking", "verbose"] as const) {
    const values = VERBOSITY_PRESETS[preset];
    if (VERBOSITY_KEYS.every((key) => settings[key] === values[key])) {
      return preset;
    }
  }
  return null;
}

export function detectVerbosity(settings: Settings): Verbosity {
  return matchedVerbosityPreset(settings) ?? settings.verbosity;
}

function readStoredValue<K extends keyof Settings>(key: K): Settings[K] | undefined {
  const storageKey = STORAGE_KEYS[key];
  const stored = localStorage.getItem(storageKey);
  if (key === "sessionListPrefs") {
    return migrateSessionListPrefs({
      stored,
      sessionsGrouping: localStorage.getItem(STORAGE_KEYS.sessionsGrouping),
      sessionSort: localStorage.getItem(STORAGE_KEYS.sessionSort),
    }) as Settings[K];
  }
  if (stored === null) return undefined;

  const defaultValue = DEFAULTS[key];
  if (key === "capabilities") {
    try {
      const parsed = PersistedCapabilitiesSchema.safeParse(JSON.parse(stored));
      return (parsed.success ? parsed.data : undefined) as Settings[K] | undefined;
    } catch {
      return undefined;
    }
  }
  if (key === "diffStyle") {
    const parsed = DiffStyleSchema.safeParse(stored);
    return (parsed.success ? parsed.data : undefined) as Settings[K] | undefined;
  }
  if (key === "motion") {
    const parsed = MotionSchema.safeParse(stored);
    return (parsed.success ? parsed.data : undefined) as Settings[K] | undefined;
  }
  if (key === "codeThemeLight") {
    const parsed = CodeThemeLightSchema.safeParse(stored);
    return (parsed.success ? parsed.data : undefined) as Settings[K] | undefined;
  }
  if (key === "codeThemeDark") {
    const parsed = CodeThemeDarkSchema.safeParse(stored);
    return (parsed.success ? parsed.data : undefined) as Settings[K] | undefined;
  }
  if (key === "transcriptWidth") {
    const parsed = TranscriptWidthSchema.safeParse(stored);
    return (parsed.success ? parsed.data : undefined) as Settings[K] | undefined;
  }
  if (key === "interfaceFont") {
    const parsed = InterfaceFontSchema.safeParse(stored);
    return (parsed.success ? parsed.data : undefined) as Settings[K] | undefined;
  }
  if (key === "transcriptTextSize") {
    const parsed = TranscriptTextSizeSchema.safeParse(stored);
    return (parsed.success ? parsed.data : undefined) as Settings[K] | undefined;
  }
  if (Array.isArray(defaultValue)) {
    try {
      const parsed = LINK_CATEGORY_RULES_SCHEMA.safeParse(JSON.parse(stored));
      return (parsed.success ? parsed.data : undefined) as Settings[K] | undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof defaultValue === "boolean") {
    return (stored === "true") as Settings[K];
  }
  if (typeof defaultValue === "number") {
    const parsed = Number(stored);
    return (Number.isFinite(parsed) ? parsed : undefined) as Settings[K] | undefined;
  }
  return stored as Settings[K];
}

function writeStoredValue<K extends keyof Settings>(key: K, value: Settings[K]): void {
  localStorage.setItem(
    STORAGE_KEYS[key],
    Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value),
  );
}

interface SettingsContextValue {
  settings: Settings;
  loaded: boolean;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setVerbosity: (verbosity: Verbosity) => void;
  resetAll: () => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULTS,
  loaded: false,
  setSetting: () => undefined,
  setVerbosity: () => undefined,
  resetAll: () => undefined,
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    migrateLegacyNotificationSetting(localStorage);
    const loaded = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as Array<keyof Settings>) {
      const stored = readStoredValue(key);
      if (stored !== undefined) {
        (loaded as Record<keyof Settings, Settings[keyof Settings]>)[key] = stored;
      }
    }
    const rawVerbosity = localStorage.getItem(STORAGE_KEYS.verbosity);
    if (rawVerbosity === "minimal") {
      const normalPreset = VERBOSITY_PRESETS.normal;
      for (const key of Object.keys(normalPreset) as Array<keyof Settings>) {
        (loaded as Record<keyof Settings, Settings[keyof Settings]>)[key] = normalPreset[
          key
        ] as Settings[keyof Settings];
        writeStoredValue(key, normalPreset[key] as Settings[keyof Settings]);
      }
      writeStoredValue("verbosity", "normal");
    }
    loaded.verbosity = detectVerbosity(loaded);
    setSettings(loaded);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.motion === "reduced") root.dataset["motion"] = "reduced";
    else delete root.dataset["motion"];
  }, [settings.motion]);

  useEffect(() => {
    const style = document.documentElement.style;
    const family = codeFontFamily(settings.codeFont);
    if (family === null) style.removeProperty("--font-mono");
    else style.setProperty("--font-mono", family);
  }, [settings.codeFont]);

  useEffect(() => {
    const style = document.documentElement.style;
    const vars = appearanceCssVars({
      interfaceFont: settings.interfaceFont,
      transcriptTextSize: settings.transcriptTextSize,
      transcriptWidth: settings.transcriptWidth,
    });
    for (const [name, value] of Object.entries(vars)) {
      if (value === null) style.removeProperty(name);
      else style.setProperty(name, value);
    }
  }, [settings.interfaceFont, settings.transcriptTextSize, settings.transcriptWidth]);

  const setSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((previous) => {
      const next = { ...previous, [key]: value };
      writeStoredValue(key, value);
      if (VERBOSITY_KEYS.includes(key)) {
        next.verbosity = detectVerbosity(next);
        writeStoredValue("verbosity", next.verbosity);
      }
      return next;
    });
  }, []);

  const setVerbosity = useCallback((verbosity: Verbosity) => {
    setSettings((previous) => {
      const preset = VERBOSITY_PRESETS[verbosity];
      const next = { ...previous, ...preset, verbosity };
      for (const key of Object.keys(preset) as Array<keyof Settings>) {
        writeStoredValue(key, next[key]);
      }
      writeStoredValue("verbosity", verbosity);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    for (const key of Object.keys(STORAGE_KEYS) as Array<keyof Settings>) {
      localStorage.removeItem(STORAGE_KEYS[key]);
    }
    setSettings(DEFAULTS);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loaded, setSetting, setVerbosity, resetAll }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
