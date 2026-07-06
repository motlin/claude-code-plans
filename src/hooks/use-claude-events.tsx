import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  DOMAIN_EVENTS,
  SSE_EVENTS,
  type HookSchemaDriftPayload,
  type JsonValue,
  type MemorySummaryPayload,
  type NotificationPayload,
  type NotificationEntryPayload,
  type NotificationClearedPayload,
  type PendingApprovalPayload,
  type PlanSummaryPayload,
  type SessionLinesAppendedPayload,
  type SessionSummaryPayload,
  type SessionToolPendingPayload,
  type SessionToolFailedPayload,
  type SubagentStartedPayload,
} from "../lib/hook-events";
import type { TranscriptData } from "../lib/api/sessions";
import { toMdSlug } from "../lib/md-slug";

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

interface ActiveSessionInfo {
  sessionId: string;
  cwd: string;
  model: string;
  startedAt: number;
  lastActivity: number;
}

export interface ClaudeEventsState {
  activeSessions: Map<string, ActiveSessionInfo>;
  /**
   * Schema-drift notifications keyed by `hookEventName`. The latest payload
   * for each event name wins; older drifts for the same event are replaced
   * so the banner shows the freshest unknown-field set rather than stacking.
   */
  hookSchemaDrifts: Map<string, HookSchemaDriftPayload>;
  /** Set of event names the user has dismissed from the banner. */
  dismissedDrifts: Set<string>;
  /**
   * Pending tool calls keyed by `sessionId` — the most recent `PreToolUse`
   * for each session. Cleared when the corresponding `PostToolUse`-driven
   * `SESSION_LINES_APPENDED` arrives (or on `SESSION_ENDED`). Used by the
   * session view to render an "in-flight" indicator before the response body
   * lands in the JSONL.
   */
  pendingTools: Map<string, SessionToolPendingPayload>;
  /**
   * Failed tool calls keyed by `${sessionId}:${toolUseId}`. Populated by
   * `PostToolUseFailure` so the session view can mark a specific tool call as
   * errored before the JSONL watcher (~2s) picks up the failure. The Map is
   * keyed by `toolUseId` rather than `sessionId` because multiple tool calls
   * can fail across a session's history.
   */
  failedTools: Map<string, SessionToolFailedPayload>;
  /**
   * Set of session ids currently mid-compaction. Populated by `PreCompact`
   * and cleared on the next `SESSION_LINES_APPENDED` for that session (the
   * compacted transcript is the first new line after compaction completes).
   */
  compactingSessions: Set<string>;
  /**
   * The most recent `Notification` payload for each session. The session
   * view / sidebar indicator surfaces this so the user sees Claude Code's
   * idle / awaiting-input notifications without having to poll.
   */
  notifications: Map<string, NotificationPayload>;
  /**
   * In-flight subagents keyed by `${sessionId}:${agentId}` (falling back to
   * `${sessionId}:${agentType}` when Claude Code didn't supply an agent id).
   * Populated by `SubagentStart` so the subagents view can render a "running"
   * pill before the corresponding `SubagentStop` lands. Cleared on
   * `SESSION_ENDED` for the parent session — the matching `SubagentStop`
   * arrives as a `SESSION_UPDATED` for the subagent's own session id, so
   * we rely on the parent's session-ended sweep rather than diffing by id.
   */
  runningSubagents: Map<string, SubagentStartedPayload>;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type ClaudeEventsAction =
  | {
      type: "SSE_EVENT";
      eventType: string;
      data: Record<string, unknown>;
      timestamp: number;
    }
  | { type: "DISMISS_DRIFT"; hookEventName: string }
  | { type: "RESET" };

// ---------------------------------------------------------------------------
// Reducer (exported for testing)
//
// After the TanStack Query migration the reducer only tracks the activeSessions
// Map — everything else (session lists, plans, memories, tasks) is managed by
// the Query cache and patched directly from the SSE listener.
// ---------------------------------------------------------------------------

export function claudeEventsReducer(
  state: ClaudeEventsState,
  action: ClaudeEventsAction,
): ClaudeEventsState {
  if (action.type === "RESET") {
    return {
      activeSessions: new Map(),
      hookSchemaDrifts: new Map(),
      dismissedDrifts: new Set(),
      pendingTools: new Map(),
      failedTools: new Map(),
      compactingSessions: new Set(),
      notifications: new Map(),
      runningSubagents: new Map(),
    };
  }

  if (action.type === "DISMISS_DRIFT") {
    const dismissedDrifts = new Set(state.dismissedDrifts);
    dismissedDrifts.add(action.hookEventName);
    return { ...state, dismissedDrifts };
  }

  if (action.eventType === DOMAIN_EVENTS.HOOK_SCHEMA_DRIFT) {
    const hookEventName =
      typeof action.data["hookEventName"] === "string" ? action.data["hookEventName"] : undefined;
    const count = typeof action.data["count"] === "number" ? action.data["count"] : 1;
    const missingFields = Array.isArray(action.data["missingFields"])
      ? (action.data["missingFields"] as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [];
    const unknownFields = Array.isArray(action.data["unknownFields"])
      ? (action.data["unknownFields"] as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [];
    if (!hookEventName) return state;
    const hookSchemaDrifts = new Map(state.hookSchemaDrifts);
    hookSchemaDrifts.set(hookEventName, {
      hookEventName,
      missingFields,
      unknownFields,
      count,
    });
    // A fresh drift re-surfaces the banner — clear the dismissal so the
    // user sees the new unknown-field set.
    const dismissedDrifts = new Set(state.dismissedDrifts);
    dismissedDrifts.delete(hookEventName);
    return { ...state, hookSchemaDrifts, dismissedDrifts };
  }

  const sessionId =
    typeof action.data["sessionId"] === "string" ? action.data["sessionId"] : undefined;

  switch (action.eventType) {
    case SSE_EVENTS.SESSION_START: {
      if (!sessionId) return state;
      const activeSessions = new Map(state.activeSessions);
      activeSessions.set(sessionId, {
        sessionId,
        cwd: typeof action.data["cwd"] === "string" ? action.data["cwd"] : "",
        model: typeof action.data["model"] === "string" ? action.data["model"] : "",
        startedAt: action.timestamp,
        lastActivity: action.timestamp,
      });
      return { ...state, activeSessions };
    }
    case SSE_EVENTS.SESSION_END: {
      if (!sessionId) return state;
      const hadActive = state.activeSessions.has(sessionId);
      const hadPending = state.pendingTools.has(sessionId);
      const hadCompacting = state.compactingSessions.has(sessionId);
      const hadNotification = state.notifications.has(sessionId);
      const hadFailed = [...state.failedTools.values()].some((f) => f.sessionId === sessionId);
      const hadRunningSubagent = [...state.runningSubagents.values()].some(
        (s) => s.sessionId === sessionId,
      );
      if (
        !hadActive &&
        !hadPending &&
        !hadCompacting &&
        !hadNotification &&
        !hadFailed &&
        !hadRunningSubagent
      )
        return state;
      const activeSessions = new Map(state.activeSessions);
      activeSessions.delete(sessionId);
      const pendingTools = new Map(state.pendingTools);
      pendingTools.delete(sessionId);
      const compactingSessions = new Set(state.compactingSessions);
      compactingSessions.delete(sessionId);
      const notifications = new Map(state.notifications);
      notifications.delete(sessionId);
      const failedTools = new Map(state.failedTools);
      for (const [key, failed] of failedTools) {
        if (failed.sessionId === sessionId) failedTools.delete(key);
      }
      const runningSubagents = new Map(state.runningSubagents);
      for (const [key, sub] of runningSubagents) {
        if (sub.sessionId === sessionId) runningSubagents.delete(key);
      }
      return {
        ...state,
        activeSessions,
        pendingTools,
        failedTools,
        compactingSessions,
        notifications,
        runningSubagents,
      };
    }
    case DOMAIN_EVENTS.SESSION_UPDATED: {
      // Domain SESSION_UPDATED carries the full session summary; only the id
      // is needed here to keep the active indicator alive.
      const session = action.data["session"] as { id?: string } | undefined;
      const id = session?.id ?? sessionId;
      if (!id) return state;
      const existing = state.activeSessions.get(id);
      if (!existing) return state;
      const activeSessions = new Map(state.activeSessions);
      activeSessions.set(id, { ...existing, lastActivity: action.timestamp });
      return { ...state, activeSessions };
    }
    case DOMAIN_EVENTS.SESSION_TOOL_PENDING: {
      if (!sessionId) return state;
      const toolName = typeof action.data["toolName"] === "string" ? action.data["toolName"] : "";
      const toolUseId =
        typeof action.data["toolUseId"] === "string" ? action.data["toolUseId"] : "";
      const pendingTools = new Map(state.pendingTools);
      pendingTools.set(sessionId, { sessionId, toolName, toolUseId });
      return { ...state, pendingTools };
    }
    case DOMAIN_EVENTS.SESSION_TOOL_FAILED: {
      if (!sessionId) return state;
      const toolName = typeof action.data["toolName"] === "string" ? action.data["toolName"] : "";
      const toolUseId =
        typeof action.data["toolUseId"] === "string" ? action.data["toolUseId"] : "";
      const error = typeof action.data["error"] === "string" ? action.data["error"] : "";
      const failedTools = new Map(state.failedTools);
      const key = `${sessionId}:${toolUseId}`;
      failedTools.set(key, { sessionId, toolName, toolUseId, error });
      // A failed tool also clears any in-flight pending indicator for the
      // same session — the tool is no longer in flight, it's errored.
      const pendingTools = new Map(state.pendingTools);
      const existingPending = pendingTools.get(sessionId);
      if (existingPending && existingPending.toolUseId === toolUseId) {
        pendingTools.delete(sessionId);
      }
      return { ...state, failedTools, pendingTools };
    }
    case DOMAIN_EVENTS.SESSION_LINES_APPENDED: {
      // Once new lines land we can clear any pending-tool / compacting state
      // for that session — the JSONL is the source of truth for what's
      // actually been executed.
      if (!sessionId) return state;
      if (!state.pendingTools.has(sessionId) && !state.compactingSessions.has(sessionId))
        return state;
      const pendingTools = new Map(state.pendingTools);
      pendingTools.delete(sessionId);
      const compactingSessions = new Set(state.compactingSessions);
      compactingSessions.delete(sessionId);
      return { ...state, pendingTools, compactingSessions };
    }
    case DOMAIN_EVENTS.SESSION_COMPACTING: {
      if (!sessionId) return state;
      const compactingSessions = new Set(state.compactingSessions);
      compactingSessions.add(sessionId);
      return { ...state, compactingSessions };
    }
    case DOMAIN_EVENTS.SESSION_COMPACTED: {
      // Symmetric with SESSION_COMPACTING — Claude Code reports compaction is
      // done, so clear the in-progress indicator without waiting for the next
      // transcript line.
      if (!sessionId) return state;
      if (!state.compactingSessions.has(sessionId)) return state;
      const compactingSessions = new Set(state.compactingSessions);
      compactingSessions.delete(sessionId);
      return { ...state, compactingSessions };
    }
    case DOMAIN_EVENTS.NOTIFICATION: {
      if (!sessionId) return state;
      const message = typeof action.data["message"] === "string" ? action.data["message"] : "";
      const title = typeof action.data["title"] === "string" ? action.data["title"] : undefined;
      const notifications = new Map(state.notifications);
      notifications.set(sessionId, { sessionId, message, title });
      return { ...state, notifications };
    }
    case DOMAIN_EVENTS.SUBAGENT_STARTED: {
      if (!sessionId) return state;
      const agentType =
        typeof action.data["agentType"] === "string" ? action.data["agentType"] : "";
      const agentId = typeof action.data["agentId"] === "string" ? action.data["agentId"] : "";
      const runningSubagents = new Map(state.runningSubagents);
      const key = `${sessionId}:${agentId || agentType}`;
      runningSubagents.set(key, { sessionId, agentType, agentId });
      return { ...state, runningSubagents };
    }
    case DOMAIN_EVENTS.SESSION_ENDED: {
      // Domain SESSION_ENDED cleans up the same per-session state the
      // legacy SESSION_END case above does, scoped to data not owned by
      // the activeSessions map (which the legacy case already clears).
      if (!sessionId) return state;
      const hasFailedForSession = [...state.failedTools.values()].some(
        (f) => f.sessionId === sessionId,
      );
      const hasRunningSubagentForSession = [...state.runningSubagents.values()].some(
        (s) => s.sessionId === sessionId,
      );
      if (
        !state.pendingTools.has(sessionId) &&
        !state.compactingSessions.has(sessionId) &&
        !state.notifications.has(sessionId) &&
        !hasFailedForSession &&
        !hasRunningSubagentForSession
      ) {
        return state;
      }
      const pendingTools = new Map(state.pendingTools);
      pendingTools.delete(sessionId);
      const compactingSessions = new Set(state.compactingSessions);
      compactingSessions.delete(sessionId);
      const notifications = new Map(state.notifications);
      notifications.delete(sessionId);
      const failedTools = new Map(state.failedTools);
      for (const [key, failed] of failedTools) {
        if (failed.sessionId === sessionId) failedTools.delete(key);
      }
      const runningSubagents = new Map(state.runningSubagents);
      for (const [key, sub] of runningSubagents) {
        if (sub.sessionId === sessionId) runningSubagents.delete(key);
      }
      return {
        ...state,
        pendingTools,
        failedTools,
        compactingSessions,
        notifications,
        runningSubagents,
      };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ClaudeEventsContextValue {
  state: ClaudeEventsState;
  subscribeStatusline: (listener: (sessionId: string) => void) => () => void;
  subscribeNotifications: (
    listener: (notification: NotificationEntryPayload) => void,
  ) => () => void;
  dismissHookSchemaDrift: (hookEventName: string) => void;
}

const ClaudeEventsContext = createContext<ClaudeEventsContextValue | null>(null);

export function useClaudeEvents(): ClaudeEventsState {
  const ctx = useContext(ClaudeEventsContext);
  if (!ctx) {
    throw new Error("useClaudeEvents must be used within a ClaudeEventsProvider");
  }
  return ctx.state;
}

export function useSubscribeNotifications(): ClaudeEventsContextValue["subscribeNotifications"] {
  const context = useContext(ClaudeEventsContext);
  if (!context) {
    throw new Error("useSubscribeNotifications must be used within a ClaudeEventsProvider");
  }
  return context.subscribeNotifications;
}

/**
 * Convenience hook: returns true if the given session ID is in the active sessions map.
 */
export function useIsSessionActive(sessionId: string): boolean {
  const { activeSessions } = useClaudeEvents();
  return activeSessions.has(sessionId);
}

/**
 * Hook returning the list of undismissed schema-drift notifications, plus a
 * dismiss callback. Components render a banner over this list and call
 * `dismiss(hookEventName)` to hide it until the next drift arrives.
 */
export function useHookSchemaDrifts(): {
  drifts: HookSchemaDriftPayload[];
  dismiss: (hookEventName: string) => void;
} {
  const ctx = useContext(ClaudeEventsContext);
  if (!ctx) {
    throw new Error("useHookSchemaDrifts must be used within a ClaudeEventsProvider");
  }
  const { hookSchemaDrifts, dismissedDrifts } = ctx.state;
  const drifts: HookSchemaDriftPayload[] = [];
  for (const [name, payload] of hookSchemaDrifts) {
    if (!dismissedDrifts.has(name)) drifts.push(payload);
  }
  return { drifts, dismiss: ctx.dismissHookSchemaDrift };
}

// ---------------------------------------------------------------------------
// Cache-patching helpers (exported for testing)
//
// Each handler applies a single domain event to the TanStack Query cache in
// place with setQueryData. Data shapes mirror the API endpoints in
// src/routes/api/ (groups of {project, projectName, entries}).
// ---------------------------------------------------------------------------

type SessionsGroup = {
  project: string;
  projectName: string;
  sessions: SessionSummaryPayload[];
};

export function applySessionAdded(queryClient: QueryClient, session: SessionSummaryPayload): void {
  queryClient.setQueryData<SessionsGroup[]>(["sessions"], (old) => {
    if (!old) return old;
    const groupIndex = old.findIndex((g) => g.project === session.project);
    if (groupIndex === -1) {
      return [
        ...old,
        {
          project: session.project,
          projectName: session.projectName,
          sessions: [session],
        },
      ];
    }
    return old.map((group, i) => {
      if (i !== groupIndex) return group;
      // If the session already exists, replace it; otherwise prepend (newest first).
      const existingIndex = group.sessions.findIndex((s) => s.id === session.id);
      if (existingIndex >= 0) {
        return {
          ...group,
          sessions: group.sessions.map((s, j) => (j === existingIndex ? session : s)),
        };
      }
      return { ...group, sessions: [session, ...group.sessions] };
    });
  });
  // Project session counts changed.
  void queryClient.invalidateQueries({ queryKey: ["projects"] });
  void queryClient.invalidateQueries({
    queryKey: ["project", session.project],
  });
  // Plan links are derived from session JSONL content — a new session may
  // reference a plan, so invalidate all plan link queries.
  void queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === "plans" && query.queryKey[2] === "links",
  });
}

export function applySessionRemoved(
  queryClient: QueryClient,
  sessionId: string,
  projectDir: string,
): void {
  queryClient.setQueryData<SessionsGroup[]>(["sessions"], (old) => {
    if (!old) return old;
    return old
      .map((group) =>
        group.project === projectDir
          ? {
              ...group,
              sessions: group.sessions.filter((s) => s.id !== sessionId),
            }
          : group,
      )
      .filter((group) => group.sessions.length > 0);
  });
  // Invalidate (don't remove) the session sub-caches so that any mounted
  // useSuspenseQuery keeps showing cached data while refetching in the
  // background. Removing queries would cause useSuspenseQuery to re-suspend,
  // which triggers the route loader. If the session is transiently missing
  // (e.g. during a DB rebuild) this can create a suspend/refetch loop.
  void queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
  void queryClient.invalidateQueries({ queryKey: ["projects"] });
  void queryClient.invalidateQueries({ queryKey: ["project", projectDir] });
}

export function applySessionUpdated(
  queryClient: QueryClient,
  session: SessionSummaryPayload,
): void {
  queryClient.setQueryData<SessionsGroup[]>(["sessions"], (old) => {
    if (!old) return old;
    return old.map((group) =>
      group.project === session.project
        ? {
            ...group,
            sessions: group.sessions.map((s) => (s.id === session.id ? session : s)),
          }
        : group,
    );
  });
  // Invalidate session detail (metadata like messageCount, gitBranch) and summary.
  // The transcript is NOT invalidated here because SESSION_LINES_APPENDED handles
  // incremental transcript updates. Invalidating the transcript would cause a
  // redundant full refetch that races with the incremental patch, potentially
  // triggering render loops when combined with useSuspenseQuery.
  void queryClient.invalidateQueries({
    queryKey: ["session", session.id, "detail"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["session", session.id, "summary"],
  });
}

export function applyPlanChanged(queryClient: QueryClient, plan: PlanSummaryPayload): void {
  // The flat plans list now carries projects[] per item which the SSE event
  // does not — invalidate to refetch instead of patching a partial shape.
  void queryClient.invalidateQueries({ queryKey: ["plans"] });
  // Plan detail and links queries must also be invalidated so the detail/edit
  // pages reflect external edits without waiting for staleTime expiry. Those
  // queries are keyed by the URL slug (no `.md`); the source viewer keeps the
  // on-disk filename.
  const slug = toMdSlug(plan.filename);
  void queryClient.invalidateQueries({ queryKey: ["plans", slug] });
  void queryClient.invalidateQueries({
    queryKey: ["plans", slug, "links"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["source", "plan", plan.filename],
  });
}

export function applyPlanRemoved(queryClient: QueryClient, filename: string): void {
  void queryClient.invalidateQueries({ queryKey: ["plans"] });
  const slug = toMdSlug(filename);
  queryClient.removeQueries({ queryKey: ["plans", slug, "links"] });
  queryClient.removeQueries({ queryKey: ["plans", slug] });
  queryClient.removeQueries({ queryKey: ["source", "plan", filename] });
}

export function applyMemoryChanged(queryClient: QueryClient, memory: MemorySummaryPayload): void {
  // Per-project memory list and detail are now keyed by project id. The detail
  // query is keyed by the URL slug (no `.md`), so strip the extension to match.
  void queryClient.invalidateQueries({
    queryKey: ["projects", memory.project, "memories"],
  });
  void queryClient.invalidateQueries({
    queryKey: ["projects", memory.project, "memories", toMdSlug(memory.filename)],
  });
}

export function applyMemoryRemoved(
  queryClient: QueryClient,
  project: string,
  filename: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: ["projects", project, "memories"],
  });
  queryClient.removeQueries({
    queryKey: ["projects", project, "memories", toMdSlug(filename)],
  });
}

export function applyTaskChanged(queryClient: QueryClient, projectDir: string): void {
  // SSE deltas only carry the changed task id — invalidate the affected
  // queries so they refetch with up-to-date payloads rather than splicing
  // partial data into the cache.
  void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  void queryClient.invalidateQueries({
    queryKey: ["tasks", "project", projectDir],
  });
}

type ApprovalsData = { approvals: PendingApprovalPayload[] };

function upsertApproval(
  approvals: PendingApprovalPayload[],
  approval: PendingApprovalPayload,
): PendingApprovalPayload[] {
  const existingIndex = approvals.findIndex((a) => a.sessionId === approval.sessionId);
  const next =
    existingIndex >= 0
      ? approvals.map((a, i) => (i === existingIndex ? approval : a))
      : [...approvals, approval];
  // Sort oldest-waiting first (ascending by blockedSince) to match the API.
  return [...next].sort((a, b) =>
    a.blockedSince < b.blockedSince ? -1 : a.blockedSince > b.blockedSince ? 1 : 0,
  );
}

function applyApprovalChanged(queryClient: QueryClient, approval: PendingApprovalPayload): void {
  queryClient.setQueryData<ApprovalsData>(["approvals"], (old) => {
    if (!old) return old;
    return { approvals: upsertApproval(old.approvals, approval) };
  });
  queryClient.setQueryData<ApprovalsData>(["approvals", approval.projectId], (old) => {
    if (!old) return old;
    return { approvals: upsertApproval(old.approvals, approval) };
  });
}

function applyApprovalResolved(queryClient: QueryClient, sessionId: string): void {
  // The project-scoped cache is keyed by projectId, which the APPROVAL_RESOLVED
  // payload does not carry. getQueriesData matches every cache whose key starts
  // with ['approvals'] — both the global list and every per-project slice — so
  // filter each in one pass.
  for (const [key, data] of queryClient.getQueriesData<ApprovalsData>({
    queryKey: ["approvals"],
  })) {
    if (!data) continue;
    queryClient.setQueryData<ApprovalsData>(key, {
      approvals: data.approvals.filter((a) => a.sessionId !== sessionId),
    });
  }
}

type NotificationsData = { notifications: NotificationEntryPayload[] };

function upsertNotification(
  notifications: NotificationEntryPayload[],
  notification: NotificationEntryPayload,
): NotificationEntryPayload[] {
  // Newest-first: drop any existing entry with the same id, then prepend the
  // fresh one so the list matches the store's newest-first ordering.
  const rest = notifications.filter((n) => n.id !== notification.id);
  return [notification, ...rest];
}

export function applyNotificationAdded(
  queryClient: QueryClient,
  notification: NotificationEntryPayload,
): void {
  queryClient.setQueryData<NotificationsData>(["notifications"], (old) => {
    if (!old) return old;
    return { notifications: upsertNotification(old.notifications, notification) };
  });
  queryClient.setQueryData<NotificationsData>(["notifications", notification.projectId], (old) => {
    if (!old) return old;
    return { notifications: upsertNotification(old.notifications, notification) };
  });
}

export function applyNotificationCleared(
  queryClient: QueryClient,
  payload: NotificationClearedPayload,
): void {
  // The project-scoped cache is keyed by projectId, which the NOTIFICATION_CLEARED
  // payload does not carry. getQueriesData matches every cache whose key starts
  // with ['notifications'] — both the global list and every per-project slice —
  // so filter/empty each in one pass. `all` empties every slice; otherwise the
  // single `id` is removed.
  for (const [key, data] of queryClient.getQueriesData<NotificationsData>({
    queryKey: ["notifications"],
  })) {
    if (!data) continue;
    queryClient.setQueryData<NotificationsData>(key, {
      notifications: payload.all ? [] : data.notifications.filter((n) => n.id !== payload.id),
    });
  }
}

/**
 * Apply SESSION_LINES_APPENDED: append raw JSONL records to the transcript
 * cache. The component's useMemo on processTranscript() recomputes
 * automatically when the cache updates.
 */
export function applySessionLinesAppended(
  queryClient: QueryClient,
  sessionId: string,
  payload: SessionLinesAppendedPayload,
): void {
  const queryKey = ["sessions", sessionId, "transcript"] as const;
  const cached = queryClient.getQueryData<TranscriptData>(queryKey);

  if (!cached) return;

  if (payload.lines.length === 0) return;

  queryClient.setQueryData<TranscriptData>(queryKey, (old) => {
    if (!old) return old;
    return {
      records: [...old.records, ...payload.lines],
      byteOffset: old.byteOffset,
    };
  });
}

function invalidateActiveSessions(queryClient: QueryClient): void {
  // The reducer owns activeSessions state; we only invalidate the query cache
  // here so components using the active-sessions query pick up changes.
  void queryClient.invalidateQueries({ queryKey: ["sessions", "active"] });
}

function invalidateTmuxWindows(queryClient: QueryClient): void {
  // The tmux window → session mapping changes exactly when session lifecycle
  // events fire (start/end re-panes; a prompt re-stamps the pane after a
  // resume). Piggyback on those events rather than adding a server broadcast.
  void queryClient.invalidateQueries({ queryKey: ["tmux", "windows"] });
}

// ---------------------------------------------------------------------------
// SSE event types we subscribe to
// ---------------------------------------------------------------------------

const LIFECYCLE_EVENT_TYPES = [SSE_EVENTS.SESSION_START, SSE_EVENTS.SESSION_END] as const;

const DOMAIN_EVENT_TYPES = [
  DOMAIN_EVENTS.SESSION_ADDED,
  DOMAIN_EVENTS.SESSION_REMOVED,
  DOMAIN_EVENTS.SESSION_UPDATED,
  DOMAIN_EVENTS.SESSION_STARTED,
  DOMAIN_EVENTS.SESSION_ENDED,
  DOMAIN_EVENTS.SESSION_LINES_APPENDED,
  DOMAIN_EVENTS.SESSION_PROMPT_SUBMITTED,
  DOMAIN_EVENTS.SESSION_TOOL_PENDING,
  DOMAIN_EVENTS.SESSION_TOOL_FAILED,
  DOMAIN_EVENTS.SESSION_COMPACTING,
  DOMAIN_EVENTS.SESSION_COMPACTED,
  DOMAIN_EVENTS.SUBAGENT_STARTED,
  DOMAIN_EVENTS.SESSION_CWD_CHANGED,
  DOMAIN_EVENTS.NOTIFICATION,
  DOMAIN_EVENTS.NOTIFICATION_ADDED,
  DOMAIN_EVENTS.NOTIFICATION_CLEARED,
  DOMAIN_EVENTS.PLAN_CHANGED,
  DOMAIN_EVENTS.PLAN_REMOVED,
  DOMAIN_EVENTS.MEMORY_CHANGED,
  DOMAIN_EVENTS.MEMORY_REMOVED,
  DOMAIN_EVENTS.TASK_CHANGED,
  DOMAIN_EVENTS.TASK_CREATED,
  DOMAIN_EVENTS.TASK_COMPLETED,
  DOMAIN_EVENTS.APPROVAL_CHANGED,
  DOMAIN_EVENTS.APPROVAL_RESOLVED,
  DOMAIN_EVENTS.HOOK_SCHEMA_DRIFT,
] as const;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ClaudeEventsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(claudeEventsReducer, undefined, () => ({
    activeSessions: new Map<string, ActiveSessionInfo>(),
    hookSchemaDrifts: new Map<string, HookSchemaDriftPayload>(),
    dismissedDrifts: new Set<string>(),
    pendingTools: new Map<string, SessionToolPendingPayload>(),
    failedTools: new Map<string, SessionToolFailedPayload>(),
    compactingSessions: new Set<string>(),
    notifications: new Map<string, NotificationPayload>(),
    runningSubagents: new Map<string, SubagentStartedPayload>(),
  }));

  const queryClient = useQueryClient();
  const statuslineListenersRef = useRef(new Set<(sessionId: string) => void>());
  const notificationListenersRef = useRef(
    new Set<(notification: NotificationEntryPayload) => void>(),
  );

  const subscribeStatusline = useCallback((listener: (sessionId: string) => void) => {
    statuslineListenersRef.current.add(listener);
    return () => {
      statuslineListenersRef.current.delete(listener);
    };
  }, []);

  const subscribeNotifications = useCallback(
    (listener: (notification: NotificationEntryPayload) => void) => {
      notificationListenersRef.current.add(listener);
      return () => {
        notificationListenersRef.current.delete(listener);
      };
    },
    [],
  );

  const dismissHookSchemaDrift = useCallback((hookEventName: string) => {
    dispatch({ type: "DISMISS_DRIFT", hookEventName });
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/events");

    function handleLifecycleEvent(e: Event) {
      const me = e as MessageEvent;
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(me.data) as Record<string, unknown>;
      } catch {
        // empty or non-JSON data is fine
      }
      dispatch({
        type: "SSE_EVENT",
        eventType: e.type,
        data,
        timestamp: Date.now(),
      });
    }

    function handleStatuslineEvent(e: Event) {
      const me = e as MessageEvent;
      try {
        const parsed = JSON.parse(me.data) as Record<string, unknown>;
        const sessionId = parsed["sessionId"];
        if (typeof sessionId === "string") {
          for (const listener of statuslineListenersRef.current) {
            listener(sessionId);
          }
        }
      } catch {
        // ignore
      }
    }

    function handleDomainEvent(e: Event) {
      const me = e as MessageEvent;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(me.data) as Record<string, unknown>;
      } catch {
        return;
      }

      switch (e.type) {
        case DOMAIN_EVENTS.SESSION_ADDED: {
          const session = data["session"] as SessionSummaryPayload | undefined;
          if (session) applySessionAdded(queryClient, session);
          break;
        }
        case DOMAIN_EVENTS.SESSION_REMOVED: {
          const sessionId = data["sessionId"];
          const projectDir = data["projectDir"];
          if (typeof sessionId === "string" && typeof projectDir === "string") {
            applySessionRemoved(queryClient, sessionId, projectDir);
          }
          break;
        }
        case DOMAIN_EVENTS.SESSION_UPDATED: {
          const session = data["session"] as SessionSummaryPayload | undefined;
          if (session) applySessionUpdated(queryClient, session);
          // Also mirror into the activeSessions reducer so the "active" dot
          // stays green while .jsonl / Stop deltas keep arriving.
          dispatch({
            type: "SSE_EVENT",
            eventType: e.type,
            data,
            timestamp: Date.now(),
          });
          break;
        }
        case DOMAIN_EVENTS.SESSION_LINES_APPENDED: {
          const sessionId = data["sessionId"];
          const lines = data["lines"];
          if (typeof sessionId === "string" && Array.isArray(lines)) {
            applySessionLinesAppended(queryClient, sessionId, {
              sessionId,
              lines: lines as Record<string, JsonValue>[],
            });
          }
          // An already-running session emits this event as it works; the
          // active-sessions query only refetches on lifecycle events, so
          // invalidate here to keep the /active page and sidebar live.
          invalidateActiveSessions(queryClient);
          // Mirror into the reducer so the pending-tool / compacting
          // indicators clear once new transcript lines actually land.
          dispatch({
            type: "SSE_EVENT",
            eventType: e.type,
            data,
            timestamp: Date.now(),
          });
          break;
        }
        case DOMAIN_EVENTS.SESSION_PROMPT_SUBMITTED: {
          // The user's prompt is rendered from this delta before the
          // JSONL flush — invalidate the transcript so the next
          // useSuspenseQuery render picks up the new line. The reducer
          // also stores the prompt so the session view can show it
          // optimistically even before the refetch returns.
          const sessionId = data["sessionId"];
          if (typeof sessionId === "string") {
            void queryClient.invalidateQueries({
              queryKey: ["sessions", sessionId, "transcript"],
            });
          }
          // A prompt re-stamps the session's tmux pane (survives a resume into
          // a new pane), so refresh the tmux window mapping.
          invalidateTmuxWindows(queryClient);
          // Surface the session on the /active page the moment a prompt is
          // submitted, before the JSONL flush and lifecycle events land.
          invalidateActiveSessions(queryClient);
          dispatch({
            type: "SSE_EVENT",
            eventType: e.type,
            data,
            timestamp: Date.now(),
          });
          break;
        }
        case DOMAIN_EVENTS.SESSION_TOOL_PENDING:
        case DOMAIN_EVENTS.SESSION_TOOL_FAILED:
        case DOMAIN_EVENTS.SESSION_COMPACTING:
        case DOMAIN_EVENTS.SESSION_COMPACTED:
        case DOMAIN_EVENTS.SUBAGENT_STARTED:
        case DOMAIN_EVENTS.NOTIFICATION: {
          dispatch({
            type: "SSE_EVENT",
            eventType: e.type,
            data,
            timestamp: Date.now(),
          });
          // SUBAGENT_STARTED also invalidates the subagents query for the
          // affected project so the gantt re-renders with the new agent
          // before the SubagentStop event lands.
          if (e.type === DOMAIN_EVENTS.SUBAGENT_STARTED) {
            void queryClient.invalidateQueries({
              predicate: (query) =>
                query.queryKey[0] === "projects" && query.queryKey[2] === "subagents",
            });
          }
          break;
        }
        case DOMAIN_EVENTS.SESSION_STARTED:
        case DOMAIN_EVENTS.SESSION_ENDED: {
          invalidateActiveSessions(queryClient);
          invalidateTmuxWindows(queryClient);
          break;
        }
        case DOMAIN_EVENTS.SESSION_CWD_CHANGED: {
          // Sessions are keyed by project (cwd) — when a session moves to a
          // new cwd the active-sessions sidebar query must refetch so the
          // session re-homes under the new project entry. Project lists are
          // also invalidated because a session leaving a project changes
          // that project's "has-active-session" status.
          invalidateActiveSessions(queryClient);
          void queryClient.invalidateQueries({ queryKey: ["projects"] });
          break;
        }
        case DOMAIN_EVENTS.PLAN_CHANGED: {
          const plan = data["plan"] as PlanSummaryPayload | undefined;
          if (plan) applyPlanChanged(queryClient, plan);
          break;
        }
        case DOMAIN_EVENTS.PLAN_REMOVED: {
          const filename = data["filename"];
          if (typeof filename === "string") applyPlanRemoved(queryClient, filename);
          break;
        }
        case DOMAIN_EVENTS.MEMORY_CHANGED: {
          const memory = data["memory"] as MemorySummaryPayload | undefined;
          if (memory) applyMemoryChanged(queryClient, memory);
          break;
        }
        case DOMAIN_EVENTS.MEMORY_REMOVED: {
          const project = data["project"];
          const filename = data["filename"];
          if (typeof project === "string" && typeof filename === "string") {
            applyMemoryRemoved(queryClient, project, filename);
          }
          break;
        }
        case DOMAIN_EVENTS.TASK_CHANGED: {
          const task = data["task"] as { projectDir?: string } | undefined;
          if (task && typeof task.projectDir === "string") {
            applyTaskChanged(queryClient, task.projectDir);
          } else {
            void queryClient.invalidateQueries({ queryKey: ["tasks"] });
          }
          break;
        }
        case DOMAIN_EVENTS.TASK_CREATED:
        case DOMAIN_EVENTS.TASK_COMPLETED: {
          void queryClient.invalidateQueries({ queryKey: ["tasks"] });
          break;
        }
        case DOMAIN_EVENTS.APPROVAL_CHANGED: {
          const approval = data["approval"] as PendingApprovalPayload | undefined;
          if (approval) applyApprovalChanged(queryClient, approval);
          break;
        }
        case DOMAIN_EVENTS.APPROVAL_RESOLVED: {
          const sessionId = data["sessionId"];
          if (typeof sessionId === "string") applyApprovalResolved(queryClient, sessionId);
          break;
        }
        case DOMAIN_EVENTS.NOTIFICATION_ADDED: {
          const notification = data["notification"] as NotificationEntryPayload | undefined;
          if (notification) {
            applyNotificationAdded(queryClient, notification);
            // Fan the fresh entry out to the desktop-notification bridge so it
            // can raise a native OS notification when the tab is backgrounded.
            for (const listener of notificationListenersRef.current) {
              listener(notification);
            }
          }
          break;
        }
        case DOMAIN_EVENTS.NOTIFICATION_CLEARED: {
          const id = data["id"];
          const all = data["all"];
          applyNotificationCleared(queryClient, {
            ...(typeof id === "string" ? { id } : {}),
            ...(typeof all === "boolean" ? { all } : {}),
          });
          break;
        }
        case DOMAIN_EVENTS.HOOK_SCHEMA_DRIFT: {
          dispatch({
            type: "SSE_EVENT",
            eventType: e.type,
            data,
            timestamp: Date.now(),
          });
          break;
        }
        default:
          break;
      }
    }

    for (const eventType of LIFECYCLE_EVENT_TYPES) {
      es.addEventListener(eventType, handleLifecycleEvent);
    }
    for (const eventType of DOMAIN_EVENT_TYPES) {
      es.addEventListener(eventType, handleDomainEvent);
    }
    es.addEventListener(SSE_EVENTS.STATUSLINE_UPDATED, handleStatuslineEvent);

    // SSE reconnection safety: with staleTime: Infinity, data is never
    // "stale" so refetchOnReconnect won't refetch after a disconnect.
    // Track errors and invalidate all queries on reconnect to catch up
    // on events missed during the gap.
    let hadError = false;
    es.onerror = () => {
      hadError = true;
    };
    es.addEventListener("open", () => {
      if (hadError) {
        hadError = false;
        void queryClient.invalidateQueries();
      }
    });

    return () => es.close();
  }, [queryClient]);

  const contextValue: ClaudeEventsContextValue = useMemo(
    () => ({ state, subscribeStatusline, subscribeNotifications, dismissHookSchemaDrift }),
    [state, subscribeStatusline, subscribeNotifications, dismissHookSchemaDrift],
  );

  return (
    <ClaudeEventsContext.Provider value={contextValue}>{children}</ClaudeEventsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Statusline hook — fetches statusline JSON and re-fetches on SSE updates
// Uses the shared EventSource from ClaudeEventsProvider instead of creating
// a separate connection (which wastes resources and can cause instability).
// ---------------------------------------------------------------------------

export function useStatusline(sessionId: string): Record<string, unknown> | null {
  const ctx = useContext(ClaudeEventsContext);
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  const fetchStatusline = useCallback(async () => {
    try {
      const { apiFetch } = await import("../lib/api/client");
      const { StatuslineResponse } = await import("../lib/api/sessions");
      const result = await apiFetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/statusline`,
        StatuslineResponse,
      );
      if (result) {
        setData(result as Record<string, unknown>);
      }
    } catch {
      // statusline not available
    }
  }, [sessionId]);

  // Initial fetch
  useEffect(() => {
    void fetchStatusline();
  }, [fetchStatusline]);

  // Subscribe to statusline updates via the shared provider EventSource
  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribeStatusline((updatedSessionId) => {
      if (updatedSessionId === sessionId) {
        void fetchStatusline();
      }
    });
  }, [ctx, sessionId, fetchStatusline]);

  return data;
}
