import { z } from "zod";

import { sessionMenuItemLabels } from "./schema-choices";

/**
 * The claude.ai/code session actions menu as data. The sidebar row menu, the
 * session header menu and the ⌘K contextual commands all render from this one
 * model; an action appears only when its capability is wired, like upstream's
 * "render the item only if its handler prop exists". Share (cloud-only) and
 * Delete (the app never deletes transcripts) are never offered.
 */
export const SessionMenuItemIdSchema = z.enum([
  "open-in",
  "open-live-terminal",
  "open-pr",
  "pin",
  "unpin",
  "mark-read",
  "mark-unread",
  "mark-completed",
  "rename",
  "copy-link",
  "fork",
  "archive",
  "unarchive",
]);

export type SessionMenuItemId = z.infer<typeof SessionMenuItemIdSchema>;

export type SessionMenuCapability =
  | "openLiveTerminal"
  | "openPr"
  | "pin"
  | "readState"
  | "ackAwaiting"
  | "rename"
  | "copyLink"
  | "fork"
  | "archive";

/** "palette-card" is the ⌘K → row-actions card, which numbers its items 1…N itself. */
export type SessionMenuSurface = "row" | "header" | "palette" | "palette-card";

/** Waiting rows get "Mark as completed"; working rows get no read-state item. */
export type SessionMenuReadState = "working" | "awaiting" | "unread" | "read";

export interface SessionMenuSession {
  title: string;
  pinned: boolean;
  readState: SessionMenuReadState;
  archived: boolean;
  prUrl: string | null;
  hasLivePane: boolean;
  forkDisabledReason: string | null;
}

export interface SessionMenuItem {
  kind: "item";
  id: SessionMenuItemId;
  label: string;
  /** Single key that fires the item while the menu is open. */
  accelerator?: string;
  disabled?: true;
  disabledReason?: string;
  submenu?: SessionMenuItem[];
}

export interface SessionMenuSeparator {
  kind: "separator";
}

export type SessionMenuEntry = SessionMenuItem | SessionMenuSeparator;

const ACCELERATORS = {
  "open-pr": "g",
  pin: "p",
  unpin: "p",
  "mark-read": "u",
  "mark-unread": "u",
  "mark-completed": "u",
  rename: "r",
  "copy-link": "c",
  fork: "f",
  archive: "a",
  unarchive: "a",
} as const satisfies Partial<Record<SessionMenuItemId, string>>;

type AcceleratedId = keyof typeof ACCELERATORS;

/** Upstream ⌘K contextual command wording; `{name}` is the truncated title. */
const PALETTE_LABELS = {
  pin: (name) => `Pin “${name}”`,
  unpin: (name) => `Unpin “${name}”`,
  rename: (name) => `Rename “${name}”`,
  "copy-link": (name) => `Copy link to “${name}”`,
  fork: (name) => `Fork “${name}”`,
  archive: (name) => `Archive “${name}”`,
  unarchive: (name) => `Unarchive “${name}”`,
} as const satisfies Partial<Record<SessionMenuItemId, (name: string) => string>>;

const PALETTE_TITLE_LENGTH = 39;

function paletteName(title: string): string {
  return title.length > PALETTE_TITLE_LENGTH ? `${title.slice(0, PALETTE_TITLE_LENGTH)}…` : title;
}

export function getSessionMenuItems(
  session: SessionMenuSession,
  capabilities: ReadonlySet<SessionMenuCapability>,
  { surface }: { surface: SessionMenuSurface },
): SessionMenuEntry[] {
  const has = (capability: SessionMenuCapability) => capabilities.has(capability);
  const item = (id: AcceleratedId): SessionMenuItem => ({
    kind: "item",
    id,
    label: sessionMenuItemLabels[id],
    accelerator: ACCELERATORS[id],
  });

  const openIn: SessionMenuItem[] = [];
  if (session.hasLivePane && has("openLiveTerminal")) {
    openIn.push({
      kind: "item",
      id: "open-live-terminal",
      label: sessionMenuItemLabels["open-live-terminal"],
    });
  }

  const navigation: SessionMenuItem[] = [];
  if (openIn.length > 0) {
    navigation.push({
      kind: "item",
      id: "open-in",
      label: sessionMenuItemLabels["open-in"],
      submenu: openIn.map((entry, index) => ({ ...entry, accelerator: String(index + 1) })),
    });
  } else if (session.prUrl !== null && has("openPr")) {
    navigation.push(item("open-pr"));
  }

  const actions: SessionMenuItem[] = [];
  if (surface !== "header" && has("pin")) actions.push(item(session.pinned ? "unpin" : "pin"));
  const readState: SessionMenuItem[] = [];
  if (surface === "row" || surface === "palette-card") {
    if (session.readState === "awaiting") {
      if (has("ackAwaiting")) readState.push(item("mark-completed"));
    } else if (session.readState !== "working" && has("readState")) {
      readState.push(item(session.readState === "unread" ? "mark-read" : "mark-unread"));
    }
  }
  if (surface === "row") actions.push(...readState);
  if (has("rename")) actions.push(item("rename"));
  if (has("copyLink")) actions.push(item("copy-link"));
  if (has("fork")) {
    actions.push(
      session.forkDisabledReason === null
        ? item("fork")
        : { ...item("fork"), disabled: true, disabledReason: session.forkDisabledReason },
    );
  }

  const lifecycle: SessionMenuItem[] = [];
  if (has("archive")) lifecycle.push(item(session.archived ? "unarchive" : "archive"));

  if (surface === "palette-card") {
    const pick = (...ids: SessionMenuItemId[]) =>
      [...actions, ...lifecycle].filter((entry) => ids.includes(entry.id));
    return [
      ...pick("copy-link"),
      ...pick("pin", "unpin"),
      ...pick("rename"),
      ...pick("archive", "unarchive"),
      ...readState,
    ].map(({ kind, id, label }) => ({ kind, id, label }));
  }

  if (surface === "palette") {
    const name = paletteName(session.title);
    return [...actions, ...lifecycle].flatMap((entry) => {
      if (!(entry.id in PALETTE_LABELS)) return [];
      const label = PALETTE_LABELS[entry.id as keyof typeof PALETTE_LABELS](name);
      const command: SessionMenuItem = { kind: "item", id: entry.id, label };
      if (entry.disabledReason !== undefined) {
        command.disabled = true;
        command.disabledReason = entry.disabledReason;
      }
      return [command];
    });
  }

  const sections = [navigation, actions, lifecycle].filter((section) => section.length > 0);
  return sections.flatMap((section, index): SessionMenuEntry[] =>
    index === 0 ? section : [{ kind: "separator" }, ...section],
  );
}
