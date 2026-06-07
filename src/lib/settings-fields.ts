export type FieldType = "boolean" | "string" | "number" | "enum" | "object";

export interface FieldDefinition {
  key: string;
  label: string;
  description: string;
  type: FieldType;
  section: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
}

export const FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    key: "model",
    label: "Model",
    description: "Default Claude model to use",
    type: "string",
    section: "General",
  },
  {
    key: "theme",
    label: "Theme",
    description: "Color scheme for the Claude Code TUI",
    type: "enum",
    section: "General",
    options: [
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
      { value: "light-daltonized", label: "Light (daltonized)" },
      { value: "dark-daltonized", label: "Dark (daltonized)" },
    ],
  },
  {
    key: "tui",
    label: "TUI mode",
    description: "Terminal UI display mode",
    type: "enum",
    section: "General",
    options: [
      { value: "fullscreen", label: "Fullscreen" },
      { value: "inline", label: "Inline" },
    ],
  },
  {
    key: "verbose",
    label: "Verbose",
    description: "Enable verbose output in the terminal",
    type: "boolean",
    section: "General",
  },
  {
    key: "includeCoAuthoredBy",
    label: "Co-authored-by",
    description: "Include co-authored-by trailer in git commits",
    type: "boolean",
    section: "General",
  },
  {
    key: "alwaysThinkingEnabled",
    label: "Extended thinking",
    description: "Enable extended thinking on every request",
    type: "boolean",
    section: "General",
  },
  {
    key: "voiceEnabled",
    label: "Voice",
    description: "Enable voice input",
    type: "boolean",
    section: "General",
  },
  {
    key: "cleanupPeriodDays",
    label: "Cleanup period (days)",
    description: "Number of days before old sessions are cleaned up",
    type: "number",
    section: "Data",
    min: 1,
  },
  {
    key: "fileCheckpointingEnabled",
    label: "File checkpointing",
    description: "Enable automatic file checkpointing for undo support",
    type: "boolean",
    section: "Data",
  },
  {
    key: "autoUpdatesChannel",
    label: "Auto-updates channel",
    description: "Release channel for automatic updates",
    type: "enum",
    section: "Updates",
    options: [
      { value: "latest", label: "Latest (stable)" },
      { value: "beta", label: "Beta" },
      { value: "disabled", label: "Disabled" },
    ],
  },
  {
    key: "enableAllProjectMcpServers",
    label: "Enable all project MCP servers",
    description: "Auto-enable MCP servers from project .mcp.json files",
    type: "boolean",
    section: "MCP",
  },
  {
    key: "skipDangerousModePermissionPrompt",
    label: "Skip dangerous mode prompt",
    description: "Skip the permission confirmation when using dangerous/yolo mode",
    type: "boolean",
    section: "Permissions",
  },
  {
    key: "teammateMode",
    label: "Teammate mode",
    description: "How Claude Code runs as a teammate / background agent",
    type: "enum",
    section: "Advanced",
    options: [
      { value: "in-process", label: "In-process" },
      { value: "detached", label: "Detached" },
    ],
  },
  {
    key: "preferredNotifChannel",
    label: "Notification channel",
    description: "Where to deliver desktop notifications",
    type: "string",
    section: "Advanced",
  },
  {
    key: "includeGitInstructions",
    label: "Git instructions",
    description: "Include git workflow instructions in the system prompt",
    type: "boolean",
    section: "General",
  },
  {
    key: "outputStyle",
    label: "Output style",
    description: "Name of the output style to use for responses",
    type: "string",
    section: "General",
  },
  {
    key: "spinnerTipsEnabled",
    label: "Spinner tips",
    description: "Show tips while the spinner is animating",
    type: "boolean",
    section: "General",
  },
  {
    key: "effortLevel",
    label: "Effort level",
    description: "Reasoning effort level (e.g. low, medium, high)",
    type: "string",
    section: "General",
  },
  {
    key: "skipWorkflowUsageWarning",
    label: "Skip workflow usage warning",
    description: "Skip the warning shown for workflow usage",
    type: "boolean",
    section: "Advanced",
  },
];

export const SECTIONS_ORDER = ["General", "Data", "Updates", "MCP", "Permissions", "Advanced"];

// Keys that have dedicated form editors (not scalar fields, not "Other")
export const DEDICATED_EDITOR_KEYS = new Set([
  "env",
  "permissions",
  "statusLine",
  "hooks",
  "enabledPlugins",
  "enabledMcpjsonServers",
  "additionalDirectories",
  "extraKnownMarketplaces",
  "sandbox",
  "remote",
  "worktree",
  "spinnerVerbs",
]);

export type ObjectSubFieldType = "boolean" | "string" | "number" | "stringList";

export interface ObjectSubField {
  key: string;
  label: string;
  description?: string;
  type: ObjectSubFieldType;
}

export interface ObjectEditorDef {
  key: string;
  label: string;
  description: string;
  section: string;
  fields: ObjectSubField[];
}

export const OBJECT_EDITORS: ObjectEditorDef[] = [
  {
    key: "sandbox",
    label: "Sandbox",
    description: "Sandboxed execution settings",
    section: "Permissions",
    fields: [
      { key: "enabled", label: "Enabled", type: "boolean" },
      {
        key: "autoAllowBashIfSandboxed",
        label: "Auto-allow Bash if sandboxed",
        type: "boolean",
      },
    ],
  },
  {
    key: "remote",
    label: "Remote",
    description: "Remote environment settings",
    section: "Advanced",
    fields: [{ key: "defaultEnvironmentId", label: "Default environment ID", type: "string" }],
  },
  {
    key: "worktree",
    label: "Worktree",
    description: "Git worktree settings",
    section: "Advanced",
    fields: [
      { key: "baseRef", label: "Base ref", type: "string" },
      { key: "bgIsolation", label: "Background isolation", type: "string" },
    ],
  },
  {
    key: "spinnerVerbs",
    label: "Spinner verbs",
    description: "Custom verbs shown while the spinner is animating",
    section: "Advanced",
    fields: [
      { key: "mode", label: "Mode", type: "string" },
      { key: "verbs", label: "Verbs", type: "stringList" },
    ],
  },
];

export const COVERED_SETTINGS_KEYS: ReadonlySet<string> = new Set<string>([
  ...FIELD_DEFINITIONS.map((f) => f.key),
  ...DEDICATED_EDITOR_KEYS,
  "$schema",
]);
