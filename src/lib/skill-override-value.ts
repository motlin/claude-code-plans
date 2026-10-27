import {z} from "zod";

/**
 * `skillOverrides[name]` values documented at
 * https://code.claude.com/docs/en/skills.md#override-skill-visibility-from-settings.
 * An absent key means "on".
 */
export const SkillOverrideValueSchema = z.enum(["on", "name-only", "user-invocable-only", "off"]);
