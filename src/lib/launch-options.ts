import { z } from "zod";

import { formatModelName } from "./model-name";
import { launchPermissionModeLabels } from "./schema-choices";

/**
 * The composer's mode / model / effort choices for the next fork or launch,
 * passed to the `claude` CLI as `--permission-mode`, `--model` and `--effort`.
 */

/** Upstream mode registry order for a local CLI session; `default` is the CLI's name for Manual. */
export const LaunchPermissionModeSchema = z.enum([
  "auto",
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
]);
export type LaunchPermissionMode = z.infer<typeof LaunchPermissionModeSchema>;

export const EffortLevelSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type EffortLevel = z.infer<typeof EffortLevelSchema>;

export const EFFORT_LEVELS = EffortLevelSchema.options;

/** Same shape `validateClaudeLaunchArgs` accepts for `--model`. */
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._[\]-]*$/;

export const LaunchOptionsSchema = z.strictObject({
  permissionMode: LaunchPermissionModeSchema.optional(),
  model: z.string().regex(MODEL_ID_PATTERN).optional(),
  effort: EffortLevelSchema.optional(),
});
export type LaunchOptions = z.infer<typeof LaunchOptionsSchema>;

/** CLI flags for the chosen options, one argv entry per word; never joined into a shell string. */
export function buildLaunchFlags({ permissionMode, model, effort }: LaunchOptions): string[] {
  const flags: string[] = [];
  if (permissionMode !== undefined) flags.push("--permission-mode", permissionMode);
  if (model !== undefined) flags.push("--model", model);
  if (effort !== undefined) flags.push("--effort", effort);
  return flags;
}

export interface ModeMenuItem {
  id: LaunchPermissionMode;
  label: string;
  description: string;
  warning: boolean;
}

const MODE_DESCRIPTIONS = {
  auto: "Claude handles permission decisions",
  default: "Always ask before making changes",
  acceptEdits: "Automatically accept all file edits",
  plan: "Create a plan before making changes",
  bypassPermissions: "Accepts all permissions",
} satisfies Record<LaunchPermissionMode, string>;

/** Chin trigger text; upstream shortens only Bypass permissions. */
export function modeTriggerLabel(mode: LaunchPermissionMode): string {
  return mode === "bypassPermissions" ? "Bypass" : launchPermissionModeLabels[mode];
}

/** Mode menu rows for a local session: Auto · Manual · Accept edits · Plan (+ Bypass when allowed). */
export function modeMenuItems(bypassPermissionsAllowed: boolean): ModeMenuItem[] {
  return LaunchPermissionModeSchema.options
    .filter((id) => id !== "bypassPermissions" || bypassPermissionsAllowed)
    .map((id) => ({
      id,
      label: launchPermissionModeLabels[id],
      description: MODE_DESCRIPTIONS[id],
      warning: id === "bypassPermissions",
    }));
}

/**
 * Bypass permissions launches without the CLI's own warning prompt only when
 * settings already opt into it.
 */
export function isBypassPermissionsAllowed(settings: {
  defaultMode?: string | undefined;
  skipDangerousModePermissionPrompt?: boolean | undefined;
}): boolean {
  return (
    settings.defaultMode === "bypassPermissions" ||
    settings.skipDangerousModePermissionPrompt === true
  );
}

export interface ModelChoice {
  id: string;
  label: string;
}

/** The CLI's family aliases, in upstream's menu order. */
export const PRIMARY_MODELS: readonly ModelChoice[] = [
  { id: "opus", label: "Opus" },
  { id: "fable", label: "Fable" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
];

/** Full model ids seen in local transcripts, newest first, for the "More models" submenu. */
export const MORE_MODELS: readonly ModelChoice[] = [
  "claude-opus-5-5",
  "claude-fable-5-1",
  "claude-sonnet-5-5",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
].map((id) => ({ id, label: formatModelName(id) ?? id }));

export function modelLabel(id: string): string {
  return (
    [...PRIMARY_MODELS, ...MORE_MODELS].find((model) => model.id === id)?.label ??
    formatModelName(id) ??
    id
  );
}
