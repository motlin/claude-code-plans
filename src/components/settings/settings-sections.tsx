import {Link} from "@tanstack/react-router";
import {useQuery} from "@tanstack/react-query";
import {lazy, type ReactNode, Suspense, useEffect, useState} from "react";
import {ArrowDown, ArrowUp, Monitor, Moon, Plus, Sun, Trash2} from "lucide-react";
import {matchedVerbosityPreset, useSettings, type Motion, type Settings, type Verbosity} from "../settings-provider";
import type {InterfaceFont, TranscriptTextSize} from "../../lib/appearance";
import type {CapabilityId} from "../../lib/capabilities";
import {
	CodeThemeDarkSchema,
	CodeThemeLightSchema,
	type CodeThemeDark,
	type CodeThemeLight,
} from "../../lib/code-themes";
import {codeThemeDarkLabels, codeThemeLightLabels, terminalAppearanceLabels} from "../../lib/schema-choices";
import {TerminalAppearanceSchema} from "../../lib/terminal-theme";
import type {TranscriptWidth} from "../../lib/transcript-width";
import {useTheme} from "../theme-provider";
import {HookSetup} from "../hook-setup";
import {SegmentedControl} from "./segmented-control";
import {SettingsRow, SettingsSection} from "./settings-row";
import {Switch} from "./switch";
import {ThemedCombobox} from "./themed-combobox";
import {applicationSettingsQueryOptions, useSaveApplicationSettings} from "../../lib/api/application-settings";

/**
 * The Settings dialog's tab panels, built from the sections the old full-page
 * /settings route rendered. Each tab composes the sections that belong to it.
 */

type BooleanSettingKey = {
	[K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];
type NumberSettingKey = {
	[K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];
type StringSettingKey = {
	[K in keyof Settings]: Settings[K] extends string ? K : never;
}[keyof Settings];

function toSlug(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

interface ToggleRowProps {
	label: string;
	description: string;
	settingKey: BooleanSettingKey;
}

function ToggleRow({label, description, settingKey}: ToggleRowProps) {
	const {settings, setSetting} = useSettings();
	const checked = settings[settingKey];

	return (
		<SettingsRow slug={toSlug(label)} title={label} description={description}>
			<Switch checked={checked} onCheckedChange={(next) => setSetting(settingKey, next)} />
		</SettingsRow>
	);
}

function CapabilityToggleRow({
	capabilityId,
	label,
	description,
}: {
	capabilityId: CapabilityId;
	label: string;
	description: string;
}) {
	const {settings, setSetting} = useSettings();
	const checked = settings.capabilities[capabilityId].enabled;

	return (
		<SettingsRow slug={toSlug(label)} title={label} description={description}>
			<Switch
				checked={checked}
				onCheckedChange={(enabled) =>
					setSetting("capabilities", {
						...settings.capabilities,
						[capabilityId]: {...settings.capabilities[capabilityId], enabled},
					})
				}
			/>
		</SettingsRow>
	);
}

const REVIEW_MODE_OPTIONS = [
	{value: "offer", label: "Offer"},
	{value: "auto", label: "Auto"},
] as const;

function WorkingCopyReviewModeRow() {
	const {settings, setSetting} = useSettings();
	const mode = settings.capabilities.workingCopyReview.config.offerMode;

	return (
		<SettingsRow
			slug="review-behavior"
			title="Review behavior"
			description="Offer a review or start one automatically"
		>
			<SegmentedControl
				value={mode}
				options={REVIEW_MODE_OPTIONS}
				onValueChange={(offerMode) =>
					setSetting("capabilities", {
						...settings.capabilities,
						workingCopyReview: {
							...settings.capabilities.workingCopyReview,
							config: {offerMode},
						},
					})
				}
			/>
		</SettingsRow>
	);
}

function useNotificationPermission() {
	const [supported, setSupported] = useState(false);
	const [permission, setPermission] = useState<NotificationPermission>("default");

	useEffect(() => {
		if (typeof window !== "undefined" && "Notification" in window) {
			setSupported(true);
			setPermission(Notification.permission);
		}
	}, []);

	/** Asks the browser when needed; resolves whether notifications may be shown. */
	const ensureGranted = async (): Promise<boolean> => {
		if (Notification.permission === "granted") return true;
		const result = await Notification.requestPermission();
		setPermission(result);
		return result === "granted";
	};

	return {supported, permission, ensureGranted};
}

interface NotificationRowProps {
	slug: string;
	title: string;
	description: string;
	settingKey: "notifyCompletions" | "notifyPermissionRequests";
	notificationPermission: ReturnType<typeof useNotificationPermission>;
	footnote?: ReactNode;
}

function NotificationRow({
	slug,
	title,
	description,
	settingKey,
	notificationPermission: {supported, permission, ensureGranted},
	footnote,
}: NotificationRowProps) {
	const {settings, setSetting} = useSettings();
	const granted = supported && permission === "granted";
	const blocked = supported && permission === "denied";

	const handleToggle = async (next: boolean) => {
		if (!supported) return;
		if (next && !(await ensureGranted())) return;
		setSetting(settingKey, next);
	};

	return (
		<SettingsRow slug={slug} title={title} description={description} footnote={footnote}>
			<Switch
				checked={granted && settings[settingKey]}
				disabled={!supported || blocked}
				onCheckedChange={(next) => void handleToggle(next)}
			/>
		</SettingsRow>
	);
}

function NotificationsSection() {
	const notificationPermission = useNotificationPermission();
	const {supported, permission} = notificationPermission;

	return (
		<SettingsSection title="Notifications">
			<NotificationRow
				slug="response-completions"
				title="Response completions"
				description="Get notified when Claude has finished a response. Useful for long-running tasks."
				settingKey="notifyCompletions"
				notificationPermission={notificationPermission}
				footnote={
					!supported ? (
						<div className="text-body text-amber-600">
							This browser does not support desktop notifications.
						</div>
					) : permission === "denied" ? (
						<div className="text-body text-amber-600">
							Notifications are blocked. Allow them for this site in your browser settings to enable.
						</div>
					) : null
				}
			/>
			<NotificationRow
				slug="code-permission-requests"
				title="Code permission requests"
				description="Get a desktop notification when Claude needs your approval to run a command in a Code session."
				settingKey="notifyPermissionRequests"
				notificationPermission={notificationPermission}
			/>
		</SettingsSection>
	);
}

interface SelectRowProps {
	label: string;
	description: string;
	settingKey: StringSettingKey;
	options: Array<{value: Settings[StringSettingKey]; label: string}>;
}

function SelectRow({label, description, settingKey, options}: SelectRowProps) {
	const {settings, setSetting} = useSettings();

	return (
		<SettingsRow slug={toSlug(label)} title={label} description={description}>
			<ThemedCombobox
				aria-label={label}
				value={settings[settingKey]}
				options={options}
				onValueChange={(next) => setSetting(settingKey, next)}
			/>
		</SettingsRow>
	);
}

interface NumberRowProps {
	label: string;
	description: string;
	settingKey: NumberSettingKey;
	min?: number;
	max?: number;
}

function NumberRow({label, description, settingKey, min, max}: NumberRowProps) {
	const {settings, setSetting} = useSettings();
	const current = settings[settingKey];

	return (
		<SettingsRow slug={toSlug(label)} title={label} description={description}>
			<input
				type="number"
				aria-label={label}
				value={current}
				min={min}
				max={max}
				onChange={(e) => {
					const parsed = Number(e.target.value);
					if (Number.isFinite(parsed)) {
						setSetting(settingKey, parsed as Settings[NumberSettingKey]);
					}
				}}
				className="h-8 w-24 rounded-r6 border border-border bg-[var(--settings-field-bg)] px-3 text-body text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-100/40"
			/>
		</SettingsRow>
	);
}

const VERBOSITY_OPTIONS: Array<{value: Verbosity; label: string}> = [
	{value: "normal", label: "Normal"},
	{value: "thinking", label: "Thinking"},
	{value: "verbose", label: "Verbose"},
];

const INTERFACE_FONT_OPTIONS: Array<{value: InterfaceFont; label: string}> = [
	{value: "sans", label: "Sans"},
	{value: "system", label: "System"},
];

const TRANSCRIPT_TEXT_SIZE_OPTIONS: Array<{value: TranscriptTextSize; label: string}> = [
	{value: "sm", label: "Small"},
	{value: "md", label: "Medium"},
	{value: "lg", label: "Large"},
];

const TRANSCRIPT_WIDTH_OPTIONS: Array<{value: TranscriptWidth; label: string}> = [
	{value: "narrow", label: "Narrow"},
	{value: "medium", label: "Medium"},
	{value: "wide", label: "Wide"},
];

function AppearanceSection() {
	const {settings, setSetting, setVerbosity} = useSettings();

	return (
		<SettingsSection title="Appearance">
			<SettingsRow
				slug="interface-font"
				title="Interface font"
				description="Font for the whole interface — menus, sidebars, and panels."
			>
				<SegmentedControl
					value={settings.interfaceFont}
					options={INTERFACE_FONT_OPTIONS}
					onValueChange={(next) => setSetting("interfaceFont", next)}
				/>
			</SettingsRow>
			<SettingsRow
				slug="transcript-text-size"
				title="Transcript text size"
				description="Size of the conversation transcript text."
			>
				<SegmentedControl
					value={settings.transcriptTextSize}
					options={TRANSCRIPT_TEXT_SIZE_OPTIONS}
					onValueChange={(next) => setSetting("transcriptTextSize", next)}
				/>
			</SettingsRow>
			<SettingsRow
				slug="transcript-width"
				title="Transcript width"
				description="Maximum width of the transcript and composer columns."
			>
				<SegmentedControl
					value={settings.transcriptWidth}
					options={TRANSCRIPT_WIDTH_OPTIONS}
					onValueChange={(next) => setSetting("transcriptWidth", next)}
				/>
			</SettingsRow>
			<SettingsRow
				slug="default-transcript-view"
				title="Default transcript view"
				description="The view sessions open in. Picking a view from a session’s Transcript view menu changes only that session."
			>
				<SegmentedControl value={settings.verbosity} options={VERBOSITY_OPTIONS} onValueChange={setVerbosity} />
			</SettingsRow>
		</SettingsSection>
	);
}

function CustomTranscriptViewNote() {
	const {settings} = useSettings();
	if (matchedVerbosityPreset(settings) !== null) return null;
	const preset = VERBOSITY_OPTIONS.find((option) => option.value === settings.verbosity);

	return (
		<p role="status" className="py-3 text-body text-[var(--settings-muted)]">
			Custom: these toggles differ from the {preset?.label} default transcript view (Claude Code ▸ Appearance).
		</p>
	);
}

const THEME_OPTIONS = [
	{value: "system", label: "System", icon: <Monitor aria-hidden="true" />},
	{value: "light", label: "Light", icon: <Sun aria-hidden="true" />},
	{value: "dark", label: "Dark", icon: <Moon aria-hidden="true" />},
] as const;

const MOTION_OPTIONS: Array<{value: Motion; label: string}> = [
	{value: "system", label: "System"},
	{value: "reduced", label: "Reduced"},
];

function MotionRow() {
	const {settings, setSetting} = useSettings();

	return (
		<SettingsRow
			slug="motion"
			title="Motion"
			description="Reduce animation in streaming responses and other interface elements."
		>
			<SegmentedControl
				value={settings.motion}
				options={MOTION_OPTIONS}
				onValueChange={(next) => setSetting("motion", next)}
			/>
		</SettingsRow>
	);
}

function ThemeRow() {
	const {theme, setTheme} = useTheme();

	return (
		<SettingsRow slug="theme" title="Theme" description="Color scheme for the interface">
			<SegmentedControl iconOnly value={theme} options={THEME_OPTIONS} onValueChange={setTheme} />
		</SettingsRow>
	);
}

export function LinkCategoryRulesSection() {
	const {settings, setSetting} = useSettings();
	const rules = settings.linkCategoryRules;

	function replaceRule(index: number, nextRule: Settings["linkCategoryRules"][number]): void {
		setSetting(
			"linkCategoryRules",
			rules.map((rule, ruleIndex) => (ruleIndex === index ? nextRule : rule)),
		);
	}

	function moveRule(index: number, destinationIndex: number): void {
		if (destinationIndex < 0 || destinationIndex >= rules.length) return;

		const reordered = [...rules];
		const selected = reordered[index];
		const destination = reordered[destinationIndex];
		if (selected === undefined || destination === undefined) return;
		reordered[index] = destination;
		reordered[destinationIndex] = selected;
		setSetting("linkCategoryRules", reordered);
	}

	return (
		<SettingsSection title="Link categories">
			<div className="py-3">
				<p className="text-body text-[var(--settings-muted)]">
					Match hostnames to custom categories in the order shown. Patterns can include globs such as
					<code className="mx-1 rounded bg-surface-0 px-1 py-0.5">*.example.com</code>
					or exact hosts such as
					<code className="ml-1 rounded bg-surface-0 px-1 py-0.5">internal-wiki</code>.
				</p>

				<div className="mt-3 space-y-2">
					{rules.map((rule, index) => (
						<div
							key={index}
							role="group"
							aria-label={`Link category rule ${index + 1}`}
							className="grid grid-cols-1 gap-2 rounded-md border border-border bg-surface-1 p-2 sm:grid-cols-[1fr_1fr_auto]"
						>
							<label className="text-xs text-t6">
								Label for rule {index + 1}
								<input
									type="text"
									value={rule.label}
									onChange={(event) => replaceRule(index, {...rule, label: event.target.value})}
									className="mt-1 block w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent-100"
								/>
							</label>
							<label className="text-xs text-t6">
								Host pattern for rule {index + 1}
								<input
									type="text"
									value={rule.hostPattern}
									placeholder="*.example.com"
									onChange={(event) =>
										replaceRule(index, {
											...rule,
											hostPattern: event.target.value,
										})
									}
									className="mt-1 block w-full rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent-100"
								/>
							</label>
							<div className="flex items-end gap-1">
								<button
									type="button"
									aria-label={`Move rule ${index + 1} up`}
									title="Move up"
									disabled={index === 0}
									onClick={() => moveRule(index, index - 1)}
									className="rounded-md border border-border p-1.5 text-secondary transition-colors hover:bg-surface-0 disabled:cursor-not-allowed disabled:opacity-40"
								>
									<ArrowUp className="h-4 w-4" />
								</button>
								<button
									type="button"
									aria-label={`Move rule ${index + 1} down`}
									title="Move down"
									disabled={index === rules.length - 1}
									onClick={() => moveRule(index, index + 1)}
									className="rounded-md border border-border p-1.5 text-secondary transition-colors hover:bg-surface-0 disabled:cursor-not-allowed disabled:opacity-40"
								>
									<ArrowDown className="h-4 w-4" />
								</button>
								<button
									type="button"
									aria-label={`Delete rule ${index + 1}`}
									title="Delete rule"
									onClick={() =>
										setSetting(
											"linkCategoryRules",
											rules.filter((_, ruleIndex) => ruleIndex !== index),
										)
									}
									className="rounded-md border border-border p-1.5 text-red-600 transition-colors hover:bg-red-600/10"
								>
									<Trash2 className="h-4 w-4" />
								</button>
							</div>
						</div>
					))}
				</div>

				<button
					type="button"
					onClick={() => setSetting("linkCategoryRules", [...rules, {label: "", hostPattern: ""}])}
					className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface-0"
				>
					<Plus className="h-4 w-4" />
					Add rule
				</button>
			</div>
		</SettingsSection>
	);
}

export function ApplicationConfigurationSection() {
	const applicationSettings = useQuery(applicationSettingsQueryOptions);
	const saveSettings = useSaveApplicationSettings();

	if (applicationSettings.isPending) {
		return (
			<SettingsSection title="Application">
				<p className="py-2 text-sm text-t6">Loading server settings…</p>
			</SettingsSection>
		);
	}

	if (applicationSettings.isError) {
		return (
			<SettingsSection title="Application">
				<p className="py-2 text-sm text-red-600">Could not load server settings.</p>
			</SettingsSection>
		);
	}

	const settings = applicationSettings.data;
	const save = (next: typeof settings) => saveSettings.mutate({...next, ignoredDirs: [...next.ignoredDirs].sort()});
	const savedIgnoredDirectories = [...settings.ignoredDirs].sort().join("\n");

	return (
		<SettingsSection title="Application">
			<ApplicationToggleRow
				label="Live Herdr input"
				description="Allow prompts, interrupts, and state reports for live Herdr terminals. Applies immediately without a server restart."
				checked={settings.herdrWritesEnabled}
				disabled={saveSettings.isPending}
				onToggle={() =>
					save({
						...settings,
						herdrWritesEnabled: !settings.herdrWritesEnabled,
					})
				}
			/>

			<ApplicationToggleRow
				label="Shell tabs"
				description="Open login shells in the session folder from the Terminal pane. Only served to this computer."
				checked={settings.shellPaneEnabled}
				disabled={saveSettings.isPending}
				onToggle={() =>
					save({
						...settings,
						shellPaneEnabled: !settings.shellPaneEnabled,
					})
				}
			/>

			<IgnoredDirectoriesField
				savedIgnoredDirectories={savedIgnoredDirectories}
				disabled={saveSettings.isPending}
				onSave={(ignoredDirs) => save({...settings, ignoredDirs})}
			/>

			{saveSettings.isError ? (
				<p className="py-2 text-xs text-red-600">Could not save application settings.</p>
			) : null}
		</SettingsSection>
	);
}

function IgnoredDirectoriesField({
	savedIgnoredDirectories,
	disabled,
	onSave,
}: {
	savedIgnoredDirectories: string;
	disabled: boolean;
	onSave: (ignoredDirs: string[]) => void;
}) {
	const [ignoredDirectories, setIgnoredDirectories] = useState(savedIgnoredDirectories);
	const [renderedSavedIgnoredDirectories, setRenderedSavedIgnoredDirectories] = useState(savedIgnoredDirectories);
	if (renderedSavedIgnoredDirectories !== savedIgnoredDirectories) {
		setRenderedSavedIgnoredDirectories(savedIgnoredDirectories);
		setIgnoredDirectories(savedIgnoredDirectories);
	}

	return (
		<div className="py-2">
			<label htmlFor="application-ignored-directories" className="text-body text-primary">
				Ignored watcher directories
			</label>
			<p className="mt-1 text-body text-[var(--settings-muted)]">
				One directory basename per line. Restart the server after saving changes.
			</p>
			<textarea
				id="application-ignored-directories"
				aria-label="Ignored watcher directories"
				value={ignoredDirectories}
				onChange={(event) => setIgnoredDirectories(event.target.value)}
				rows={6}
				className="mt-2 w-full rounded-md border border-border bg-surface-1 px-3 py-2 font-mono text-sm text-primary"
			/>
			<button
				type="button"
				disabled={disabled}
				onClick={() =>
					onSave(
						ignoredDirectories
							.split("\n")
							.map((directory) => directory.trim())
							.filter(Boolean),
					)
				}
				className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface-0 disabled:cursor-wait disabled:opacity-50"
			>
				Save ignored directories
			</button>
		</div>
	);
}

function ApplicationToggleRow({
	label,
	description,
	checked,
	disabled,
	onToggle,
}: {
	label: string;
	description: string;
	checked: boolean;
	disabled: boolean;
	onToggle: () => void;
}) {
	return (
		<SettingsRow slug={toSlug(label)} title={label} description={description}>
			<Switch checked={checked} disabled={disabled} onCheckedChange={onToggle} />
		</SettingsRow>
	);
}

function ResetAllSettings() {
	const {resetAll} = useSettings();
	const [confirmReset, setConfirmReset] = useState(false);

	return (
		<div className="border-t border-border pt-6">
			{confirmReset ? (
				<div className="flex items-center gap-3">
					<span className="text-sm text-secondary">Reset all settings to defaults?</span>
					<button
						type="button"
						onClick={() => {
							resetAll();
							setConfirmReset(false);
						}}
						className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
					>
						Confirm
					</button>
					<button
						type="button"
						onClick={() => setConfirmReset(false)}
						className="rounded-md border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface-0"
					>
						Cancel
					</button>
				</div>
			) : (
				<button
					type="button"
					onClick={() => setConfirmReset(true)}
					className="rounded-md border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface-0"
				>
					Reset all to defaults
				</button>
			)}
		</div>
	);
}

export function GeneralSettings() {
	return (
		<>
			<SettingsSection title="Appearance">
				<ThemeRow />
				<MotionRow />
				<ToggleRow
					label="Hide chrome"
					description="Hide the sidebar and header for a focused view"
					settingKey="chromeHidden"
				/>
				<ToggleRow
					label="Status footer"
					description="Show the status bar at the bottom of session views"
					settingKey="statusFooterVisible"
				/>
			</SettingsSection>
			<SettingsSection title="Home">
				<ToggleRow
					label="Recent plans and memories"
					description="Show local Recent plans and Memories updated sections on the home page"
					settingKey="homeShowLocalSections"
				/>
			</SettingsSection>
			<NotificationsSection />
			<ResetAllSettings />
		</>
	);
}

// Lazy so the Settings dialog, which the root mounts, keeps Shiki out of the entry bundle.
const CodeThemePreview = lazy(() =>
	import("./code-theme-preview").then((module) => ({default: module.CodeThemePreview})),
);

const CODE_THEME_LIGHT_OPTIONS: Array<{value: CodeThemeLight; label: string}> = CodeThemeLightSchema.options.map(
	(value) => ({value, label: codeThemeLightLabels[value]}),
);
const CODE_THEME_DARK_OPTIONS: Array<{value: CodeThemeDark; label: string}> = CodeThemeDarkSchema.options.map(
	(value) => ({value, label: codeThemeDarkLabels[value]}),
);

function CodeAppearanceSection() {
	const {settings, setSetting} = useSettings();

	return (
		<SettingsSection title="Code appearance">
			<div data-settings-row="code-theme" className="grid grid-cols-1 gap-4 py-3 sm:grid-cols-2">
				<div className="flex min-w-0 flex-col gap-2">
					<ThemedCombobox
						aria-label="Light code theme"
						value={settings.codeThemeLight}
						options={CODE_THEME_LIGHT_OPTIONS}
						onValueChange={(next) => setSetting("codeThemeLight", next)}
						className="w-full"
					/>
					<Suspense>
						<CodeThemePreview theme={settings.codeThemeLight} label="Light code theme preview" />
					</Suspense>
				</div>
				<div className="flex min-w-0 flex-col gap-2">
					<ThemedCombobox
						aria-label="Dark code theme"
						value={settings.codeThemeDark}
						options={CODE_THEME_DARK_OPTIONS}
						onValueChange={(next) => setSetting("codeThemeDark", next)}
						className="w-full"
					/>
					<Suspense>
						<CodeThemePreview theme={settings.codeThemeDark} label="Dark code theme preview" />
					</Suspense>
				</div>
			</div>
			<SelectRow
				label="Terminal colors"
				description="Follow the light and dark code theme, or use your Ghostty config."
				settingKey="terminalAppearance"
				options={TerminalAppearanceSchema.options.map((value) => ({
					value,
					label: terminalAppearanceLabels[value],
				}))}
			/>
			<SettingsRow
				slug="code-font"
				title="Code font"
				description="Set a custom monospace font for code and terminal."
			>
				<input
					type="text"
					aria-label="Code font"
					placeholder="e.g. JetBrains Mono"
					value={settings.codeFont}
					onChange={(event) => setSetting("codeFont", event.target.value)}
					className="h-8 w-[220px] rounded-r6 border border-border bg-[var(--settings-field-bg)] px-3 text-body text-primary outline-none placeholder:text-[var(--settings-muted)] focus-visible:ring-2 focus-visible:ring-accent-100/40"
				/>
			</SettingsRow>
		</SettingsSection>
	);
}

export function ClaudeCodeSettings() {
	return (
		<>
			<CodeAppearanceSection />
			<AppearanceSection />
		</>
	);
}

export function TranscriptSettings() {
	return (
		<>
			<SettingsSection title="Session Display">
				<CustomTranscriptViewNote />
				<ToggleRow
					label="Thinking"
					description="Show Claude's extended thinking blocks"
					settingKey="showThinking"
				/>
				<ToggleRow label="Tools" description="Show tool calls and results" settingKey="showTools" />
				<ToggleRow
					label="Tool duration"
					description="Show execution time for tool calls"
					settingKey="showToolDuration"
				/>
				<ToggleRow
					label="Debug"
					description="Show debug information and raw JSONL data"
					settingKey="showDebug"
				/>
			</SettingsSection>

			<SettingsSection title="Hooks">
				<ToggleRow
					label="Passed hooks"
					description="Show hooks that passed without issues"
					settingKey="showPassedHooks"
				/>
				<ToggleRow
					label="Hook warnings"
					description="Show non-blocking hook warnings and additional context"
					settingKey="showHookWarnings"
				/>
				<ToggleRow
					label="Hook errors"
					description="Show blocking hook errors and cancellations"
					settingKey="showHookErrors"
				/>
			</SettingsSection>

			<SettingsSection title="System Content">
				<ToggleRow
					label="System banners"
					description="Show system-level banner messages"
					settingKey="showSystemBanners"
				/>
				<ToggleRow
					label="Show compact summaries inline"
					description="Render full /compact recap messages instead of a collapsed stub"
					settingKey="showCompactSummaries"
				/>
				<ToggleRow
					label="Show transcript-only system records"
					description="Render synthesized records that Claude never saw as input"
					settingKey="showTranscriptOnly"
				/>
			</SettingsSection>

			<LinkCategoryRulesSection />
		</>
	);
}

export function SessionsSettings() {
	return (
		<>
			<SettingsSection title="Active sessions">
				<SelectRow
					label="Active session order"
					description="Prioritize sessions needing attention or keep creation order stable"
					settingKey="sessionSort"
					options={[
						{value: "urgency", label: "Urgency"},
						{value: "stable", label: "Stable"},
					]}
				/>
				<SelectRow
					label="Sessions page grouping"
					description="Group the Sessions page by project or by time"
					settingKey="sessionsGrouping"
					options={[
						{value: "project", label: "Project"},
						{value: "time", label: "Time"},
					]}
				/>
				<NumberRow
					label="Active timeout (seconds)"
					description="Seconds of inactivity before a session is considered idle"
					settingKey="activeTimeoutSec"
					min={10}
					max={600}
				/>
			</SettingsSection>

			<SettingsSection title="Sub-agents">
				<SelectRow
					label="Default view"
					description="Initial view mode for sub-agent visualizations"
					settingKey="defaultSubagentView"
					options={[
						{value: "tree", label: "Tree"},
						{value: "gantt", label: "Gantt"},
						{value: "sequence", label: "Sequence"},
					]}
				/>
			</SettingsSection>
		</>
	);
}

export function AiFeaturesSettings() {
	return (
		<SettingsSection title="AI Features">
			<ToggleRow
				label="Summary button"
				description="Show the Generate Summary button on session detail pages"
				settingKey="showSummaryButton"
			/>
			<CapabilityToggleRow
				capabilityId="workingCopyReview"
				label="Working-copy review"
				description="Offer or run a diff review after a completed turn"
			/>
			<WorkingCopyReviewModeRow />
			<CapabilityToggleRow
				capabilityId="sessionContextBrief"
				label="Session context brief"
				description="Inject indexed project context when Claude starts or resumes"
			/>
			<CapabilityToggleRow
				capabilityId="readOnlyMcpServer"
				label="Read-only MCP server"
				description="Expose the indexed session corpus to an explicitly launched MCP server"
			/>
		</SettingsSection>
	);
}

export function ClaudeConfigSettings() {
	return (
		<SettingsSection title="Claude Config">
			<SettingsRow
				slug="claude-code-settings-files"
				title="Claude Code settings files"
				description="Edit settings.json, permissions, hooks, and environment for Claude Code"
			>
				<Link
					to="/settings/edit"
					className="inline-flex h-8 shrink-0 items-center rounded-r6 border border-border px-3 text-body text-secondary transition-colors hover:bg-fill-ghost-hover"
				>
					Open editor
				</Link>
			</SettingsRow>
		</SettingsSection>
	);
}

export function SetupSettings() {
	return (
		<>
			<p className="text-sm text-t6">
				Configure Claude Code to send hook events to this server for live updates.
			</p>
			<HookSetup />
		</>
	);
}
