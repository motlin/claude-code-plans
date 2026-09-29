import { z } from "zod";

/**
 * Sidebar sections the user can pin or move under More ▸, in nav order. The session list is
 * absent because, like upstream's session list, it cannot be toggled.
 */
export const NAV_SECTIONS = [
  "active",
  "herdr",
  "tmux",
  "approvals",
  "notifications",
  "starred",
  "tasks",
  "projects",
  "plans",
  "memories",
  "plugins",
  "settings",
  "config",
  "setup",
] as const;

export const NavSectionSchema = z.enum(NAV_SECTIONS);

export type NavSection = z.infer<typeof NavSectionSchema>;

export const VisibleNavSectionsSchema = z
  .array(NavSectionSchema)
  .refine((sections) => new Set(sections).size === sections.length, "Duplicate nav section");

/** Upstream pins New, Artifacts and Customize (Plugins here); Plans and Memories stay local. */
export const DEFAULT_VISIBLE_NAV_SECTIONS: readonly NavSection[] = ["plans", "memories", "plugins"];

function inNavOrder(sections: ReadonlySet<NavSection>): NavSection[] {
  return NAV_SECTIONS.filter((section) => sections.has(section));
}

/** Carry the retired Herdr/Tmux visibility flags into the pinned set. */
export function migrateLegacyNavFlags(legacy: {
  showHerdrSection?: boolean | undefined;
  showTmuxSection?: boolean | undefined;
}): NavSection[] {
  const visible = new Set<NavSection>(DEFAULT_VISIBLE_NAV_SECTIONS);
  if (legacy.showHerdrSection === true) visible.add("herdr");
  if (legacy.showTmuxSection === true) visible.add("tmux");
  return inNavOrder(visible);
}

/** Toggle one section, keeping nav order. */
export function toggleNavSection(
  visible: readonly NavSection[],
  section: NavSection,
  pinned: boolean,
): NavSection[] {
  const next = new Set(visible);
  if (pinned) next.add(section);
  else next.delete(section);
  return inNavOrder(next);
}
