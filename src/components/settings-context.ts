import {createContext, useContext} from "react";
import {z} from "zod";

import {ACTIVE_SESSION_WINDOW_MS} from "../lib/active-session-window";
import {DEFAULT_CAPABILITIES, PersistedCapabilitiesSchema, type PersistedCapabilities} from "../lib/capabilities";
import {objectKeys} from "../lib/narrow";
import {DEFAULT_SESSION_LIST_PREFS, migrateSessionListPrefs, type SessionListPrefs} from "../lib/session-groups";
import {
	CodeThemeDarkSchema,
	CodeThemeLightSchema,
	DEFAULT_CODE_THEMES,
	type CodeThemeDark,
	type CodeThemeLight,
} from "../lib/code-themes";
import {DEFAULT_TERMINAL_APPEARANCE, TerminalAppearanceSchema, type TerminalAppearance} from "../lib/terminal-theme";
import {TranscriptWidthSchema, type TranscriptWidth} from "../lib/transcript-width";
import {
	InterfaceFontSchema,
	TranscriptTextSizeSchema,
	type InterfaceFont,
	type TranscriptTextSize,
} from "../lib/appearance";

const SubagentViewSchema = z.enum(["tree", "gantt", "sequence"]);
type SubagentView = z.infer<typeof SubagentViewSchema>;

/** The Changes pane's diff layout: one column, or old and new side by side. */
export const DiffStyleSchema = z.enum(["unified", "split"]);
export type DiffStyle = z.infer<typeof DiffStyleSchema>;
const VerbositySchema = z.enum(["normal", "thinking", "verbose"]);
export type Verbosity = z.infer<typeof VerbositySchema>;

const SessionSortSchema = z.enum(["urgency", "stable"]);
const SessionsGroupingSchema = z.enum(["project", "time"]);

/** Upstream General ▸ Appearance ▸ Motion: follow the OS, or always reduce. */
const MotionSchema = z.enum(["system", "reduced"]);

/** Upstream's Notification sound: the OS default sound, or a silent banner. */
const NotificationSoundSchema = z.enum(["system", "none"]);
export type NotificationSound = z.infer<typeof NotificationSoundSchema>;
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
	/** "reduced" sets `html[data-motion=reduced]`, which stops pulses and transitions. */
	motion: Motion;
	/** The transcript and composer column measure: 768, 960 or 1280px. */
	transcriptWidth: TranscriptWidth;
	/** Interface font: the bundled sans, or the OS UI font via `--font-sans` on <html>. */
	interfaceFont: InterfaceFont;
	/** Transcript body text size, set as `--transcript-text-size` on <html>. */
	transcriptTextSize: TranscriptTextSize;
	/** Show the CLI's ai-title under a differing /rename title in the header and sidebar hover card. */
	showAiTitles: boolean;
	/** The composer's project · branch +N −M strip; off matches claude.ai/code, which shows none without a PR. */
	showChangesStrip: boolean;
	/** The local-only "Review this turn's uncommitted changes?" banner; off matches claude.ai/code, which has none. */
	offerWorkingCopyReview: boolean;
	/** Shiki theme for code in light mode. */
	codeThemeLight: CodeThemeLight;
	/** Shiki theme for code in dark mode. */
	codeThemeDark: CodeThemeDark;
	/** Custom monospace font family for code and terminal; empty keeps the built-in stack. */
	codeFont: string;
	/** Terminal colors: the light/dark code theme (upstream's behavior) or the Ghostty config. */
	terminalAppearance: TerminalAppearance;

	showSummaryButton: boolean;
	// ccp preferences are browser-local; /api/settings reflects Claude's own files and is read-only.
	capabilities: PersistedCapabilities;

	activeTimeoutSec: number;

	sessionSort: z.infer<typeof SessionSortSchema>;

	/** How /sessions organizes its list. "project" matches the sidebar's tree. */
	sessionsGrouping: z.infer<typeof SessionsGroupingSchema>;

	/** The sidebar session list's Filter & group menu choices. */
	sessionListPrefs: SessionListPrefs;

	/** Desktop notification when a session finishes and needs review (upstream "Response completions"). */
	notifyCompletions: boolean;
	/** Desktop notification when a session waits on the user (upstream "Code permission requests"). */
	notifyPermissionRequests: boolean;
	/** "none" raises notifications with `silent: true` (upstream "Notification sound"). */
	notificationSound: NotificationSound;

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

	/** The sidebar's one-time "drag to pin" coach mark was dismissed or a drag pin happened. */
	seenDragPinHint: boolean;
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
	motion: "system",
	transcriptWidth: "narrow",
	interfaceFont: "sans",
	transcriptTextSize: "md",
	showAiTitles: true,
	showChangesStrip: false,
	offerWorkingCopyReview: false,
	codeThemeLight: DEFAULT_CODE_THEMES.light,
	codeThemeDark: DEFAULT_CODE_THEMES.dark,
	codeFont: "",
	terminalAppearance: DEFAULT_TERMINAL_APPEARANCE,

	showSummaryButton: true,
	capabilities: DEFAULT_CAPABILITIES,

	activeTimeoutSec: ACTIVE_SESSION_WINDOW_MS / 1000,

	sessionSort: "urgency",

	sessionsGrouping: "project",

	sessionListPrefs: DEFAULT_SESSION_LIST_PREFS,

	notifyCompletions: true,
	notifyPermissionRequests: false,
	notificationSound: "system",

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

	seenDragPinHint: false,
};

export const STORAGE_KEYS: Record<keyof Settings, string> = {
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
	motion: "ccp-motion",
	transcriptWidth: "ccp-transcript-width",
	interfaceFont: "ccp-interface-font",
	transcriptTextSize: "ccp-transcript-text-size",
	showAiTitles: "ccp-show-ai-titles",
	showChangesStrip: "ccp-show-changes-strip",
	offerWorkingCopyReview: "ccp-offer-working-copy-review",
	codeThemeLight: "ccp-code-theme-light",
	codeThemeDark: "ccp-code-theme-dark",
	codeFont: "ccp-code-font",
	terminalAppearance: "ccp-terminal-appearance",
	showSummaryButton: "ccp-show-summary-button",
	capabilities: "ccp-capabilities",
	activeTimeoutSec: "ccp-active-timeout",
	sessionSort: "ccp-session-sort",
	sessionsGrouping: "ccp-sessions-grouping",
	sessionListPrefs: "ccp-session-list-prefs",
	notifyCompletions: "ccp-notify-completions",
	notifyPermissionRequests: "ccp-notify-permission-requests",
	notificationSound: "ccp-notification-sound",
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
	seenDragPinHint: "ccp-seen-drag-pin-hint",
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
export function migrateLegacyNotificationSetting(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): void {
	const legacy = storage.getItem(LEGACY_DESKTOP_NOTIFICATIONS_KEY);
	if (legacy === null) return;
	const value = legacy === "true" ? "true" : "false";
	for (const key of ["notifyCompletions", "notifyPermissionRequests"] as const) {
		if (storage.getItem(STORAGE_KEYS[key]) === null) storage.setItem(STORAGE_KEYS[key], value);
	}
	storage.removeItem(LEGACY_DESKTOP_NOTIFICATIONS_KEY);
}

/** Keys of settings that no longer exist; loading drops them from storage. */
const RETIRED_STORAGE_KEYS = ["ccp-status-footer"] as const;

export function dropRetiredSettings(storage: Pick<Storage, "removeItem">): void {
	for (const key of RETIRED_STORAGE_KEYS) storage.removeItem(key);
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

export const VERBOSITY_KEYS = objectKeys(VERBOSITY_PRESETS.normal);

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

type StoredValueReader<V> = (stored: string | null) => V | undefined;

function readSchema<V>(schema: z.ZodType<V>): StoredValueReader<V> {
	return (stored) => {
		if (stored === null) return undefined;
		const parsed = schema.safeParse(stored);
		return parsed.success ? parsed.data : undefined;
	};
}

function readJsonSchema<V>(schema: z.ZodType<V>): StoredValueReader<V> {
	return (stored) => {
		if (stored === null) return undefined;
		try {
			const parsed = schema.safeParse(JSON.parse(stored));
			return parsed.success ? parsed.data : undefined;
		} catch {
			return undefined;
		}
	};
}

const readBoolean: StoredValueReader<boolean> = (stored) => (stored === null ? undefined : stored === "true");

const readNumber: StoredValueReader<number> = (stored) => {
	if (stored === null) return undefined;
	const parsed = Number(stored);
	return Number.isFinite(parsed) ? parsed : undefined;
};

const readString: StoredValueReader<string> = (stored) => stored ?? undefined;

const STORED_VALUE_READERS: {[K in keyof Settings]: StoredValueReader<Settings[K]>} = {
	showThinking: readBoolean,
	showTools: readBoolean,
	showDebug: readBoolean,
	showToolDuration: readBoolean,
	showPassedHooks: readBoolean,
	showHookWarnings: readBoolean,
	showHookErrors: readBoolean,
	showSystemBanners: readBoolean,
	showCompactSummaries: readBoolean,
	showTranscriptOnly: readBoolean,
	defaultSubagentView: readSchema(SubagentViewSchema),
	chromeHidden: readBoolean,
	motion: readSchema(MotionSchema),
	transcriptWidth: readSchema(TranscriptWidthSchema),
	interfaceFont: readSchema(InterfaceFontSchema),
	transcriptTextSize: readSchema(TranscriptTextSizeSchema),
	showAiTitles: readBoolean,
	showChangesStrip: readBoolean,
	offerWorkingCopyReview: readBoolean,
	codeThemeLight: readSchema(CodeThemeLightSchema),
	codeThemeDark: readSchema(CodeThemeDarkSchema),
	codeFont: readString,
	terminalAppearance: readSchema(TerminalAppearanceSchema),
	showSummaryButton: readBoolean,
	capabilities: readJsonSchema(PersistedCapabilitiesSchema),
	activeTimeoutSec: readNumber,
	sessionSort: readSchema(SessionSortSchema),
	sessionsGrouping: readSchema(SessionsGroupingSchema),
	// Read even when unset: older installs stored the grouping and sort under separate keys.
	sessionListPrefs: (stored) =>
		migrateSessionListPrefs({
			stored,
			sessionsGrouping: localStorage.getItem(STORAGE_KEYS.sessionsGrouping),
			sessionSort: localStorage.getItem(STORAGE_KEYS.sessionSort),
		}),
	notifyCompletions: readBoolean,
	notifyPermissionRequests: readBoolean,
	notificationSound: readSchema(NotificationSoundSchema),
	verbosity: readSchema(VerbositySchema),
	linkCategoryRules: readJsonSchema(LINK_CATEGORY_RULES_SCHEMA),
	diffShowTree: readBoolean,
	diffGroupByFolder: readBoolean,
	diffGroupByKind: readBoolean,
	diffStyle: readSchema(DiffStyleSchema),
	diffWordWrap: readBoolean,
	diffWordDiff: readBoolean,
	diffHideWhitespace: readBoolean,
	filesHideIgnored: readBoolean,
	filesPreviewTabs: readBoolean,
	filesTreeWidth: readNumber,
	filesWordWrap: readBoolean,
	filesTabSize: readNumber,
	seenDragPinHint: readBoolean,
};

export function readStoredValue<K extends keyof Settings>(key: K): Settings[K] | undefined {
	const reader: StoredValueReader<Settings[K]> = STORED_VALUE_READERS[key];
	return reader(localStorage.getItem(STORAGE_KEYS[key]));
}

export function writeStoredValue<K extends keyof Settings>(key: K, value: Settings[K]): void {
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

export const SettingsContext = createContext<SettingsContextValue>({
	settings: DEFAULTS,
	loaded: false,
	setSetting: () => undefined,
	setVerbosity: () => undefined,
	resetAll: () => undefined,
});

export function useSettings(): SettingsContextValue {
	return useContext(SettingsContext);
}
