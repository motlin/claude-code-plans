import { z } from "zod";

/**
 * Sidebar section appearance, like claude.ai/code's `setCustomGroupAppearance`
 * and `folderAppearanceByKey`: an optional icon and color shown on a custom
 * group or project section header.
 */
export const GroupIconSchema = z.enum([
  "folder",
  "star",
  "heart",
  "flag",
  "bookmark",
  "zap",
  "code",
  "bug",
  "rocket",
  "book",
  "briefcase",
  "home",
]);

export const GroupColorSchema = z.enum([
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
]);

export const GroupAppearanceSchema = z.strictObject({
  icon: GroupIconSchema.optional(),
  color: GroupColorSchema.optional(),
});

export type GroupIcon = z.infer<typeof GroupIconSchema>;
export type GroupColor = z.infer<typeof GroupColorSchema>;
export type GroupAppearance = z.infer<typeof GroupAppearanceSchema>;

/** A change to an appearance: a value sets the key, null clears it, absent keeps it. */
export interface GroupAppearancePatch {
  icon?: GroupIcon | null;
  color?: GroupColor | null;
}

/** `current` with `patch` applied; cleared keys are removed rather than left undefined. */
export function applyAppearancePatch<T extends GroupAppearance>(
  current: T,
  patch: GroupAppearancePatch,
): T {
  const next: T = { ...current };
  if (patch.icon === null) delete next.icon;
  else if (patch.icon !== undefined) next.icon = patch.icon;
  if (patch.color === null) delete next.color;
  else if (patch.color !== undefined) next.color = patch.color;
  return next;
}
