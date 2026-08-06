import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Eye,
  Gauge,
  GitFork,
  Info,
  Link2,
  Palette,
  Plus,
  Sparkles,
  Trash2,
  Webhook,
  Wrench,
} from "lucide-react";
import { useSettings, type Settings, type Verbosity } from "../components/settings-provider";
import { useTheme } from "../components/theme-provider";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [{ title: "Settings" }],
  }),
});

type BooleanSettingKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];
type NumberSettingKey = {
  [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];
type StringSettingKey = {
  [K in keyof Settings]: Settings[K] extends string ? K : never;
}[keyof Settings];

interface ToggleRowProps {
  label: string;
  description: string;
  settingKey: BooleanSettingKey;
}

function ToggleRow({ label, description, settingKey }: ToggleRowProps) {
  const { settings, setSetting } = useSettings();
  const checked = settings[settingKey];

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="text-sm font-medium text-text-100">{label}</div>
        <div className="text-xs text-text-500">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => setSetting(settingKey, !checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
          checked ? "bg-accent-100" : "bg-bg-300"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </div>
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

  const handleToggle = async () => {
    if (!supported) return;
    const next = !checked;
    if (next && Notification.permission !== "granted") {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;
    }
    setSetting("desktopNotifications", next);
  };

  const blocked = supported && permission === "denied";

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="text-sm font-medium text-text-100">Desktop notifications</div>
        <div className="text-xs text-text-500">
          Show native OS notifications when an agent needs input or finishes while this tab is in
          the background
        </div>
        {!supported && (
          <div className="mt-1 text-xs text-amber-600">
            This browser does not support desktop notifications.
          </div>
        )}
        {blocked && (
          <div className="mt-1 text-xs text-amber-600">
            Notifications are blocked. Allow them for this site in your browser settings to enable.
          </div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={!supported || blocked}
        onClick={() => void handleToggle()}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-accent-100" : "bg-bg-300"
        } ${!supported || blocked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
    </div>
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
  const current = settings[settingKey];

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="text-sm font-medium text-text-100">{label}</div>
        <div className="text-xs text-text-500">{description}</div>
      </div>
      <select
        value={current}
        onChange={(e) => setSetting(settingKey, e.target.value as Settings[StringSettingKey])}
        className="rounded-md border border-border-300/15 bg-bg-100 px-2 py-1 text-sm text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-100"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
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
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="text-sm font-medium text-text-100">{label}</div>
        <div className="text-xs text-text-500">{description}</div>
      </div>
      <input
        type="number"
        value={current}
        min={min}
        max={max}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed)) {
            setSetting(settingKey, parsed as Settings[NumberSettingKey]);
          }
        }}
        className="w-20 rounded-md border border-border-300/15 bg-bg-100 px-2 py-1 text-sm text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-100"
      />
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1">
      <div className="flex items-center gap-2 pb-1">
        <Icon className="h-4 w-4 text-text-500" />
        <h2 className="text-sm font-semibold text-text-100">{title}</h2>
      </div>
      <div className="divide-y divide-border-300/10">{children}</div>
    </section>
  );
}

function VerbositySection() {
  const { settings, setVerbosity } = useSettings();
  const verbosity = settings.verbosity;

  const presets: Array<{
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

  const isCustom = !presets.some((p) => p.value === verbosity);

  return (
    <Section icon={Gauge} title="Verbosity">
      <div className="py-2">
        <div className="flex gap-2">
          {presets.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => setVerbosity(preset.value)}
              title={preset.description}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                verbosity === preset.value
                  ? "bg-accent-100 text-white"
                  : "border border-border-300/15 text-text-300 hover:bg-bg-200"
              }`}
            >
              {preset.label}
            </button>
          ))}
          {isCustom && (
            <span className="flex items-center rounded-md bg-bg-300/50 px-3 py-1.5 text-sm text-text-500">
              Custom
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-text-500">
          {isCustom
            ? "Individual toggles have been customized below."
            : presets.find((p) => p.value === verbosity)?.description}
        </p>
      </div>
    </Section>
  );
}

function ThemeRow() {
  const { theme, setTheme } = useTheme();
  const options: Array<{ value: typeof theme; label: string }> = [
    { value: "light", label: "Light" },
    { value: "system", label: "System" },
    { value: "dark", label: "Dark" },
  ];

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="text-sm font-medium text-text-100">Theme</div>
        <div className="text-xs text-text-500">Color scheme for the interface</div>
      </div>
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as typeof theme)}
        className="rounded-md border border-border-300/15 bg-bg-100 px-2 py-1 text-sm text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-100"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
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
    <Section icon={Link2} title="Link categories">
      <div className="py-2">
        <p className="text-xs text-text-500">
          Match hostnames to custom categories in the order shown. Patterns can include globs such
          as
          <code className="mx-1 rounded bg-bg-200 px-1 py-0.5">*.example.com</code>
          or exact hosts such as
          <code className="ml-1 rounded bg-bg-200 px-1 py-0.5">internal-wiki</code>.
        </p>

        <div className="mt-3 space-y-2">
          {rules.map((rule, index) => (
            <div
              key={index}
              role="group"
              aria-label={`Link category rule ${index + 1}`}
              className="grid grid-cols-1 gap-2 rounded-md border border-border-300/15 bg-bg-100 p-2 sm:grid-cols-[1fr_1fr_auto]"
            >
              <label className="text-xs text-text-500">
                Label for rule {index + 1}
                <input
                  type="text"
                  value={rule.label}
                  onChange={(event) => replaceRule(index, { ...rule, label: event.target.value })}
                  className="mt-1 block w-full rounded-md border border-border-300/15 bg-bg-100 px-2 py-1.5 text-sm text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-100"
                />
              </label>
              <label className="text-xs text-text-500">
                Host pattern for rule {index + 1}
                <input
                  type="text"
                  value={rule.hostPattern}
                  placeholder="*.example.com"
                  onChange={(event) =>
                    replaceRule(index, { ...rule, hostPattern: event.target.value })
                  }
                  className="mt-1 block w-full rounded-md border border-border-300/15 bg-bg-100 px-2 py-1.5 text-sm text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-100"
                />
              </label>
              <div className="flex items-end gap-1">
                <button
                  type="button"
                  aria-label={`Move rule ${index + 1} up`}
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => moveRule(index, index - 1)}
                  className="rounded-md border border-border-300/15 p-1.5 text-text-300 transition-colors hover:bg-bg-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move rule ${index + 1} down`}
                  title="Move down"
                  disabled={index === rules.length - 1}
                  onClick={() => moveRule(index, index + 1)}
                  className="rounded-md border border-border-300/15 p-1.5 text-text-300 transition-colors hover:bg-bg-200 disabled:cursor-not-allowed disabled:opacity-40"
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
                  className="rounded-md border border-border-300/15 p-1.5 text-red-600 transition-colors hover:bg-red-600/10"
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
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border-300/15 px-3 py-1.5 text-sm text-text-300 transition-colors hover:bg-bg-200"
        >
          <Plus className="h-4 w-4" />
          Add rule
        </button>
      </div>
    </Section>
  );
}

function SettingsPage() {
  const { resetAll } = useSettings();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="max-w-3xl">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-text-500">Configure display, appearance, and behavior.</p>
      </div>

      <div className="mt-6 space-y-6">
        <VerbositySection />

        <Section icon={Eye} title="Session Display">
          <ToggleRow
            label="Thinking"
            description="Show Claude's extended thinking blocks"
            settingKey="showThinking"
          />
          <ToggleRow
            label="Tools"
            description="Show tool calls and results"
            settingKey="showTools"
          />
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
        </Section>

        <Section icon={Webhook} title="Hooks">
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
        </Section>

        <Section icon={Info} title="System Content">
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
        </Section>

        <Section icon={GitFork} title="Sub-agents">
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
        </Section>

        <Section icon={Palette} title="Appearance">
          <ThemeRow />
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
        </Section>

        <Section icon={Bell} title="Notifications">
          <DesktopNotificationsRow />
        </Section>

        <LinkCategoryRulesSection />

        <Section icon={Sparkles} title="AI Features">
          <ToggleRow
            label="Summary button"
            description="Show the Generate Summary button on session detail pages"
            settingKey="showSummaryButton"
          />
        </Section>

        <Section icon={Wrench} title="Advanced">
          <NumberRow
            label="Active timeout (seconds)"
            description="Seconds of inactivity before a session is considered idle"
            settingKey="activeTimeoutSec"
            min={10}
            max={600}
          />
        </Section>
      </div>

      <div className="mt-8 border-t border-border-300/15 pt-6">
        {confirmReset ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-text-300">Reset all settings to defaults?</span>
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
              className="rounded-md border border-border-300/15 px-3 py-1.5 text-sm text-text-300 transition-colors hover:bg-bg-200"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="rounded-md border border-border-300/15 px-3 py-1.5 text-sm text-text-300 transition-colors hover:bg-bg-200"
          >
            Reset all to defaults
          </button>
        )}
      </div>
    </div>
  );
}
