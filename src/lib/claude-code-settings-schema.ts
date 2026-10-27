import {z} from "zod";

/*
 * The /api/claude-code-settings wire shapes, kept free of server-only imports
 * so the Settings dialog can validate responses without bundling fs code.
 */

/**
 * Scalar settings.json keys the Claude Code settings tab may write. Dotted
 * keys are nested paths. Nothing outside this list is ever written here.
 */
export const CLAUDE_CODE_SETTING_KEYS = [
	"outputStyle",
	"remoteControlAtStartup",
	"skipDangerousModePermissionPrompt",
	"sandbox.enabled",
	"enableWorkflows",
] as const;

export type ClaudeCodeSettingKey = (typeof CLAUDE_CODE_SETTING_KEYS)[number];

export const ClaudeCodeSettingsStateSchema = z.strictObject({
	mtimeMs: z.number().nullable(),
	values: z.partialRecord(z.enum(CLAUDE_CODE_SETTING_KEYS), z.union([z.string(), z.boolean()])),
	/** Present when `permissions.disableBypassPermissionsMode` is "disable", which locks the bypass row. */
	bypassPermissionsModeDisabled: z.literal(true).optional(),
});
export type ClaudeCodeSettingsState = z.infer<typeof ClaudeCodeSettingsStateSchema>;

/** `value` omitted (undefined) deletes the key. */
export const ClaudeCodeSettingPatchSchema = z.strictObject({
	key: z.enum(CLAUDE_CODE_SETTING_KEYS),
	value: z.unknown().optional(),
	expectedMtimeMs: z.number().nullable(),
});
