import { useSyncExternalStore } from "react";
import { z } from "zod";

import {
  applyAppearancePatch,
  GroupColorSchema,
  GroupIconSchema,
  type GroupAppearancePatch,
} from "./group-appearance";

/**
 * Per-browser custom session groups, like claude.ai/code's `customGroupsByScope`:
 * ordered `groups`, at most one group per session in `assignments`, and an
 * optional manual in-group `order` (sessions not listed follow the Sort by).
 * Each group may carry an `icon` and `color` shown on its section header.
 */
export const SESSION_GROUP_STORAGE_KEY = "ccp-session-groups";

const CustomSessionGroupSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: GroupIconSchema.optional(),
  color: GroupColorSchema.optional(),
});

const SessionGroupStateSchema = z
  .strictObject({
    groups: z.array(CustomSessionGroupSchema),
    assignments: z.record(z.string(), z.string()),
    order: z.record(z.string(), z.array(z.string())),
  })
  .superRefine((state, ctx) => {
    const ids = new Set(state.groups.map((group) => group.id));
    if (ids.size !== state.groups.length) {
      ctx.addIssue({ code: "custom", message: "Duplicate group id" });
    }
    for (const groupId of Object.values(state.assignments)) {
      if (!ids.has(groupId)) ctx.addIssue({ code: "custom", message: "Unknown assigned group" });
    }
    for (const groupId of Object.keys(state.order)) {
      if (!ids.has(groupId)) ctx.addIssue({ code: "custom", message: "Unknown ordered group" });
    }
  });

export type CustomSessionGroup = z.infer<typeof CustomSessionGroupSchema>;
export type SessionGroupState = z.infer<typeof SessionGroupStateSchema>;

const EMPTY_STATE: SessionGroupState = { groups: [], assignments: {}, order: {} };

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedState: SessionGroupState = EMPTY_STATE;

function readRaw(): string | null {
  try {
    return localStorage.getItem(SESSION_GROUP_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): SessionGroupState {
  if (raw === null) return EMPTY_STATE;
  try {
    const result = SessionGroupStateSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

/** Current groups; absent, corrupt or unreadable storage yields no groups. */
export function readSessionGroupState(): SessionGroupState {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedState = parse(raw);
  }
  return cachedState;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function write(state: SessionGroupState): void {
  try {
    localStorage.setItem(SESSION_GROUP_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be denied or full; groups are best-effort per browser.
  }
  notify();
}

/** `order` with `sessionId` removed from every list, dropping lists that become empty. */
function withoutOrdered(
  order: SessionGroupState["order"],
  sessionId: string,
): SessionGroupState["order"] {
  const next: SessionGroupState["order"] = {};
  for (const [groupId, ids] of Object.entries(order)) {
    const rest = ids.filter((id) => id !== sessionId);
    if (rest.length > 0) next[groupId] = rest;
  }
  return next;
}

export function listGroups(): CustomSessionGroup[] {
  return readSessionGroupState().groups;
}

/** Append a new group named `name` (trimmed) as the last section. A blank name throws. */
export function createGroup(name: string): CustomSessionGroup {
  const trimmed = name.trim();
  if (trimmed === "") throw new Error("Group name must not be blank");
  const state = readSessionGroupState();
  const group: CustomSessionGroup = { id: `cg-${crypto.randomUUID()}`, name: trimmed };
  write({ ...state, groups: [...state.groups, group] });
  return group;
}

/** Rename a group; a blank name or unknown id is ignored. */
export function renameGroup(id: string, name: string): void {
  const trimmed = name.trim();
  const state = readSessionGroupState();
  if (trimmed === "" || !state.groups.some((group) => group.id === id)) return;
  write({
    ...state,
    groups: state.groups.map((group) => (group.id === id ? { ...group, name: trimmed } : group)),
  });
}

/** Set or clear a group's header icon and color; unknown ids are ignored. */
export function setGroupAppearance(id: string, patch: GroupAppearancePatch): void {
  const state = readSessionGroupState();
  if (!state.groups.some((group) => group.id === id)) return;
  write({
    ...state,
    groups: state.groups.map((group) =>
      group.id === id ? applyAppearancePatch(group, patch) : group,
    ),
  });
}

/** Delete a group, returning its sessions to Ungrouped. Returns how many were released. */
export function deleteGroup(id: string): number {
  const state = readSessionGroupState();
  if (!state.groups.some((group) => group.id === id)) return 0;
  const assignments: SessionGroupState["assignments"] = {};
  let released = 0;
  for (const [sessionId, groupId] of Object.entries(state.assignments)) {
    if (groupId === id) released += 1;
    else assignments[sessionId] = groupId;
  }
  const { [id]: _removed, ...order } = state.order;
  write({ groups: state.groups.filter((group) => group.id !== id), assignments, order });
  return released;
}

export interface AssignOptions {
  /**
   * Place the session in the group's manual order just before this session, or
   * at the end of it when null or not ordered. Omit to leave it unordered.
   */
  before?: string | null;
}

/** Move a session into a group (leaving any other), or to Ungrouped with null. */
export function assign(
  sessionId: string,
  groupId: string | null,
  options: AssignOptions = {},
): void {
  const state = readSessionGroupState();
  if (groupId !== null && !state.groups.some((group) => group.id === groupId)) return;
  const { [sessionId]: _previous, ...assignments } = state.assignments;
  const order = withoutOrdered(state.order, sessionId);
  if (groupId !== null) {
    assignments[sessionId] = groupId;
    const { before } = options;
    if (before !== undefined) {
      const rest = order[groupId] ?? [];
      const index = before === null ? -1 : rest.indexOf(before);
      order[groupId] =
        index === -1
          ? [...rest, sessionId]
          : [...rest.slice(0, index), sessionId, ...rest.slice(index)];
    }
  }
  write({ groups: state.groups, assignments, order });
}

/** Replace a group's manual in-group order; an empty list clears it. Unknown groups are ignored. */
export function setGroupOrder(groupId: string, sessionIds: readonly string[]): void {
  const state = readSessionGroupState();
  if (!state.groups.some((group) => group.id === groupId)) return;
  const { [groupId]: _previous, ...order } = state.order;
  if (sessionIds.length > 0) order[groupId] = [...sessionIds];
  write({ ...state, order });
}

/** Move a group section to `toIndex`, clamped to the list. */
export function moveGroup(id: string, toIndex: number): void {
  const state = readSessionGroupState();
  const group = state.groups.find((candidate) => candidate.id === id);
  if (group === undefined) return;
  const rest = state.groups.filter((candidate) => candidate.id !== id);
  const index = Math.max(0, Math.min(toIndex, rest.length));
  write({ ...state, groups: [...rest.slice(0, index), group, ...rest.slice(index)] });
}

/** Reorder every group section by name, A to Z. */
export function sortGroupsByName(): void {
  const state = readSessionGroupState();
  const groups = [...state.groups].sort((first, second) =>
    first.name.localeCompare(second.name, undefined, { sensitivity: "base" }),
  );
  write({ ...state, groups });
}

function onStorage(event: StorageEvent): void {
  if (event.key === null || event.key === SESSION_GROUP_STORAGE_KEY) notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getServerSnapshot(): SessionGroupState {
  return EMPTY_STATE;
}

export interface SessionGroupsSnapshot extends SessionGroupState {
  groupOf: (sessionId: string) => string | null;
}

/** Live custom groups for this browser, kept in sync across tabs via the `storage` event. */
export function useSessionGroups(): SessionGroupsSnapshot {
  const state = useSyncExternalStore(subscribe, readSessionGroupState, getServerSnapshot);
  return { ...state, groupOf: (sessionId) => state.assignments[sessionId] ?? null };
}
