import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Monitor, Moon, Plus, Sun, Trash2 } from "lucide-react";
import { useSettings, type Settings, type Verbosity } from "../settings-provider";
import type { CapabilityId } from "../../lib/capabilities";
import type { TranscriptWidth } from "../../lib/transcript-width";
import { useTheme } from "../theme-provider";
import { HookSetup } from "../hook-setup";
import { SegmentedControl } from "./segmented-control";
import { SettingsRow, SettingsSection } from "./settings-row";
import { Switch } from "./switch";
import { ThemedCombobox } from "./themed-combobox";
import {
  applicationSettingsQueryOptions,
  useSaveApplicationSettings,
} from "../../lib/api/application-settings";

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

function ToggleRow({ label, description, settingKey }: ToggleRowProps) {
  const { settings, setSetting } = useSettings();
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
  const { settings, setSetting } = useSettings();
  const checked = settings.capabilities[capabilityId].enabled;

  return (
    <SettingsRow slug={toSlug(label)} title={label} description={description}>
      <Switch
        checked={checked}
        onCheckedChange={(enabled) =>
          setSetting("capabilities", {
            ...settings.capabilities,
            [capabilityId]: { ...settings.capabilities[capabilityId], enabled },
          })
        }
      />
    </SettingsRow>
  );
}

const REVIEW_MODE_OPTIONS = [
  { value: "offer", label: "Offer" },
  { value: "auto", label: "Auto" },
] as const;

function WorkingCopyReviewModeRow() {
  const { settings, setSetting } = useSettings();
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
              config: { offerMode },
            },
          })
        }
      />
    </SettingsRow>
  );
}

function DesktopNotificationsRow() {
  const { settings, setSetting } = useSettings();
  const checked = settings.desktopNotifications;
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setSupported(true);
      setPermission(Notification.permission);
    }
  }, []);

  const handleToggle = async (next: boolean) => {
    if (!supported) return;
    if (next && Notification.permission !== "granted") {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;
    }
    setSetting("desktopNotifications", next);
  };

  const blocked = supported && permission === "denied";

  return (
    <SettingsRow
      slug="desktop-notifications"
      title="Desktop notifications"
      description="Show native OS notifications when an agent needs input or finishes while this tab is in the background"
      footnote={
        !supported ? (
          <div className="text-body text-amber-600">
            This browser does not support desktop notifications.
          </div>
        ) : blocked ? (
          <div className="text-body text-amber-600">
            Notifications are blocked. Allow them for this site in your browser settings to enable.
          </div>
        ) : null
      }
    >
      <Switch
        checked={checked}
        disabled={!supported || blocked}
        onCheckedChange={(next) => void handleToggle(next)}
      />
    </SettingsRow>
  );
}

interface SelectRowProps {
  label: string;
  description: string;
  settingKey: StringSettingKey;
  options: Array<{ value: Settings[StringSettingKey]; label: string }>;
}

function SelectRow({ label, description, settingKey, options }: SelectRowProps) {
  const { settings, setSetting } = useSettings();

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

function NumberRow({ label, description, settingKey, min, max }: NumberRowProps) {
  const { settings, setSetting } = useSettings();
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

const VERBOSITY_PRESETS: ReadonlyArray<{
  value: Verbosity;
  label: string;
  description: string;
}> = [
  {
    value: "normal",
    label: "Normal",
    description: "Show tools, hook warnings, and errors (default)",
  },
  {
    value: "thinking",
    label: "Thinking",
    description: "Show tools, thinking, hook warnings, and errors",
  },
  {
    value: "verbose",
    label: "Verbose",
    description: "Show tools, thinking, hooks, and system content",
  },
];

const TRANSCRIPT_WIDTH_OPTIONS: Array<{ value: TranscriptWidth; label: string }> = [
  { value: "narrow", label: "Narrow" },
  { value: "medium", label: "Medium" },
  { value: "wide", label: "Wide" },
];

function TranscriptWidthRow() {
  const { settings, setSetting } = useSettings();

  return (
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
  );
}

function VerbositySection() {
  const { settings, setVerbosity } = useSettings();
  const verbosity = settings.verbosity;
  const preset = VERBOSITY_PRESETS.find((p) => p.value === verbosity);

  return (
    <SettingsSection title="Verbosity">
      <SettingsRow
        slug="default-transcript-view"
        title="Default transcript view"
        description={
          preset === undefined
            ? "Individual toggles have been customized in the Transcript tab."
            : preset.description
        }
      >
        <SegmentedControl
          value={verbosity}
          options={VERBOSITY_PRESETS}
          onValueChange={setVerbosity}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

const THEME_OPTIONS = [
  { value: "system", label: "System", icon: <Monitor aria-hidden="true" /> },
  { value: "light", label: "Light", icon: <Sun aria-hidden="true" /> },
  { value: "dark", label: "Dark", icon: <Moon aria-hidden="true" /> },
] as const;

function ThemeRow() {
  const { theme, setTheme } = useTheme();

  return (
    <SettingsRow slug="theme" title="Theme" description="Color scheme for the interface">
      <SegmentedControl iconOnly value={theme} options={THEME_OPTIONS} onValueChange={setTheme} />
    </SettingsRow>
  );
}

export function LinkCategoryRulesSection() {
  const { settings, setSetting } = useSettings();
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
          Match hostnames to custom categories in the order shown. Patterns can include globs such
          as
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
                  onChange={(event) => replaceRule(index, { ...rule, label: event.target.value })}
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
          onClick={() =>
            setSetting("linkCategoryRules", [...rules, { label: "", hostPattern: "" }])
          }
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
  const save = (next: typeof settings) =>
    saveSettings.mutate({ ...next, ignoredDirs: [...next.ignoredDirs].sort() });
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

      <IgnoredDirectoriesField
        savedIgnoredDirectories={savedIgnoredDirectories}
        disabled={saveSettings.isPending}
        onSave={(ignoredDirs) => save({ ...settings, ignoredDirs })}
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
  const [renderedSavedIgnoredDirectories, setRenderedSavedIgnoredDirectories] =
    useState(savedIgnoredDirectories);
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
  const { resetAll } = useSettings();
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
        <TranscriptWidthRow />
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
      <ResetAllSettings />
    </>
  );
}

export function UsageSettings() {
  return (
    <p className="text-sm text-t6">
      Rate-limit usage is shown per session in the status footer for now.
    </p>
  );
}

export function ClaudeCodeSettings() {
  return <VerbositySection />;
}

export function TranscriptSettings() {
  return (
    <>
      <SettingsSection title="Session Display">
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
            { value: "urgency", label: "Urgency" },
            { value: "stable", label: "Stable" },
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
            { value: "tree", label: "Tree" },
            { value: "gantt", label: "Gantt" },
            { value: "sequence", label: "Sequence" },
          ]}
        />
      </SettingsSection>
    </>
  );
}

export function NotificationsSettings() {
  return (
    <SettingsSection title="Notifications">
      <DesktopNotificationsRow />
    </SettingsSection>
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
