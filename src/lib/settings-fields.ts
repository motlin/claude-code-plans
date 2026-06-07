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

export const OBJECT_EDITORS: ObjectEditorDef[] = [];

export const COVERED_SETTINGS_KEYS: ReadonlySet<string> = new Set<string>([
  ...FIELD_DEFINITIONS.map((f) => f.key),
  ...DEDICATED_EDITOR_KEYS,
  "$schema",
]);
