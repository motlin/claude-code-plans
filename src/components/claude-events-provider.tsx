import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {
	DOMAIN_EVENTS,
	HERDR_EVENTS,
	SSE_EVENTS,
	type HookSchemaDriftPayload,
	type JsonValue,
	type MemorySummaryPayload,
	type NotificationPayload,
	type NotificationEntryPayload,
	type PendingApprovalPayload,
	type PlanSummaryPayload,
	type SessionHookContextPayload,
	type SessionSummaryPayload,
	type SessionToolPendingPayload,
	type SessionToolFailedPayload,
	type SubagentStartedPayload,
} from "../lib/hook-events";
import type {LiveSubagentNode} from "../lib/live-subagent-store";
import {groupedSessionsQueryOptions, recentSessionsInfiniteQueryOptions, sessionQueryKeys} from "../lib/api/sessions";
import {syncUnseenFromSummaries} from "../lib/unread-store";
import {syncUnseenFromQueryCache} from "../lib/unseen-query-sync";
import {isLiveSessionState, type ActivityState} from "../lib/session-state";
import {openSharedEventSource} from "../lib/shared-event-source";
import {startLiveAppendJourneys} from "../lib/perf/field-journeys";
import {
	ClaudeEventsContext,
	applyApprovalChanged,
	applyApprovalResolved,
	applyMemoryChanged,
	applyMemoryRemoved,
	applyNotificationAdded,
	applyNotificationCleared,
	applyPlanChanged,
	applyPlanRemoved,
	applyReconnected,
	applySessionActivity,
	applySessionAdded,
	applySessionLinesAppended,
	applySessionRemoved,
	applySessionUpdated,
	applyTaskChanged,
	claudeEventsReducer,
	invalidateActiveSessions,
	invalidateTerminalPlacements,
	toSessionStateObservation,
	type ActiveSessionInfo,
	type ClaudeEventsAction,
	type ClaudeEventsContextValue,
	type ClaudeEventsState,
	type SessionStateObservation,
} from "../hooks/use-claude-events";

// ---------------------------------------------------------------------------
// SSE event types we subscribe to
// ---------------------------------------------------------------------------

const LIFECYCLE_EVENT_TYPES = [SSE_EVENTS.SESSION_START, SSE_EVENTS.SESSION_END] as const;
const HERDR_EVENT_TYPES = Object.values(HERDR_EVENTS);

const DOMAIN_EVENT_TYPES = [
	DOMAIN_EVENTS.SESSION_ADDED,
	DOMAIN_EVENTS.SESSION_REMOVED,
	DOMAIN_EVENTS.SESSION_UPDATED,
	DOMAIN_EVENTS.SESSION_STARTED,
	DOMAIN_EVENTS.SESSION_ENDED,
	DOMAIN_EVENTS.SESSION_LINES_APPENDED,
	DOMAIN_EVENTS.SESSION_PROMPT_SUBMITTED,
	DOMAIN_EVENTS.SESSION_HOOK_CONTEXT_CHANGED,
	DOMAIN_EVENTS.SESSION_TOOL_PENDING,
	DOMAIN_EVENTS.SESSION_TOOL_FAILED,
	DOMAIN_EVENTS.SESSION_COMPACTING,
	DOMAIN_EVENTS.SESSION_COMPACTED,
	DOMAIN_EVENTS.SUBAGENT_STARTED,
	DOMAIN_EVENTS.SUBAGENT_STOPPED,
	DOMAIN_EVENTS.SUBAGENTS_SNAPSHOT,
	DOMAIN_EVENTS.SESSION_CWD_CHANGED,
	DOMAIN_EVENTS.MESSAGE_DISPLAYED,
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
	DOMAIN_EVENTS.REVIEW_OFFERED,
	DOMAIN_EVENTS.JOBS_CHANGED,
] as const;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ClaudeEventsProvider({children}: {children: ReactNode}) {
	// useState, not useReducer: React bails out of an update whose reducer returns
	// the same state before rendering only for useState, so an event that changes
	// nothing (lines appended to a session with no pending tool) costs no commit.
	const [state, setState] = useState<ClaudeEventsState>(() => ({
		activeSessions: new Map<string, ActiveSessionInfo>(),
		hookContexts: new Map<string, SessionHookContextPayload>(),
		hookSchemaDrifts: new Map<string, HookSchemaDriftPayload>(),
		dismissedDrifts: new Set<string>(),
		pendingTools: new Map<string, SessionToolPendingPayload>(),
		failedTools: new Map<string, SessionToolFailedPayload>(),
		compactingSessions: new Set<string>(),
		notifications: new Map<string, NotificationPayload>(),
		runningSubagents: new Map<string, SubagentStartedPayload>(),
		liveSubagents: new Map<string, LiveSubagentNode>(),
	}));
	const dispatch = useCallback((action: ClaudeEventsAction) => {
		setState((current) => claudeEventsReducer(current, action));
	}, []);

	const queryClient = useQueryClient();
	const statuslineListenersRef = useRef(new Set<(sessionId: string) => void>());
	const reviewOfferListenersRef = useRef(new Set<(sessionId: string) => void>());
	const sessionRemovalListenersRef = useRef(new Set<(sessionId: string) => void>());
	const sessionStateListenersRef = useRef(new Set<(session: SessionStateObservation) => void>());
	const sessionStateObservationsRef = useRef(new Map<string, SessionStateObservation>());

	const subscribeStatusline = useCallback((listener: (sessionId: string) => void) => {
		statuslineListenersRef.current.add(listener);
		return () => {
			statuslineListenersRef.current.delete(listener);
		};
	}, []);

	const subscribeReviewOffers = useCallback((listener: (sessionId: string) => void) => {
		reviewOfferListenersRef.current.add(listener);
		return () => {
			reviewOfferListenersRef.current.delete(listener);
		};
	}, []);

	const subscribeSessionRemovals = useCallback((listener: (sessionId: string) => void) => {
		sessionRemovalListenersRef.current.add(listener);
		return () => {
			sessionRemovalListenersRef.current.delete(listener);
		};
	}, []);

	const subscribeSessionStates = useCallback(
		(listener: (session: SessionStateObservation) => void) => {
			const recent = queryClient.getQueryData<{
				pages: Array<{sessions: SessionSummaryPayload[]}>;
			}>(recentSessionsInfiniteQueryOptions().queryKey);
			const grouped = queryClient.getQueryData<Array<{sessions: SessionSummaryPayload[]}>>(
				groupedSessionsQueryOptions().queryKey,
			);
			const summaries = [
				...(recent?.pages.flatMap((page) => page.sessions) ?? []),
				...(grouped?.flatMap((group) => group.sessions) ?? []),
			];
			const seededSessionIds = new Set<string>();
			for (const summary of summaries) {
				if (seededSessionIds.has(summary.id)) continue;
				seededSessionIds.add(summary.id);
				const existing = sessionStateObservationsRef.current.get(summary.id);
				const observation = existing
					? {...existing, label: summary.title.trim() || summary.projectName}
					: toSessionStateObservation(summary);
				if (observation === null) continue;
				sessionStateObservationsRef.current.set(summary.id, observation);
				listener(observation);
			}

			sessionStateListenersRef.current.add(listener);
			return () => {
				sessionStateListenersRef.current.delete(listener);
			};
		},
		[queryClient],
	);

	const dismissHookSchemaDrift = useCallback(
		(hookEventName: string) => {
			dispatch({type: "DISMISS_DRIFT", hookEventName});
		},
		[dispatch],
	);

	useEffect(() => syncUnseenFromQueryCache(queryClient), [queryClient]);

	useEffect(() => {
		const timer = setInterval(() => {
			dispatch({type: "SWEEP_LIVE_SUBAGENTS", timestamp: Date.now()});
		}, 60_000);
		return () => {
			clearInterval(timer);
		};
	}, [dispatch]);

	useEffect(() => {
		function publishSessionState(sessionId: string, state: ActivityState, summary?: SessionSummaryPayload): void {
			const existing = sessionStateObservationsRef.current.get(sessionId);
			const observation = summary
				? toSessionStateObservation(summary)
				: {
						sessionId,
						label: existing?.label ?? sessionId,
						state,
						archived: existing?.archived ?? false,
					};
			if (observation === null) return;
			sessionStateObservationsRef.current.set(sessionId, observation);
			for (const listener of sessionStateListenersRef.current) listener(observation);
		}

		function handleLifecycleEvent(e: Event) {
			const me = e as MessageEvent<string>;
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
			const me = e as MessageEvent<string>;
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
			const me = e as MessageEvent<string>;
			let data: Record<string, unknown>;
			try {
				data = JSON.parse(me.data) as Record<string, unknown>;
			} catch {
				return;
			}

			switch (e.type) {
				case DOMAIN_EVENTS.SESSION_ADDED: {
					const session = data["session"] as SessionSummaryPayload | undefined;
					if (session) {
						// Before publishing, so display-state listeners see the server's unseen flag.
						syncUnseenFromSummaries([session]);
						if (isLiveSessionState(session.state)) {
							publishSessionState(session.id, session.state, session);
						}
						applySessionAdded(queryClient, session);
					}
					break;
				}
				case DOMAIN_EVENTS.SESSION_REMOVED: {
					const sessionId = data["sessionId"];
					const projectDir = data["projectDir"];
					if (typeof sessionId === "string" && typeof projectDir === "string") {
						applySessionRemoved(queryClient, sessionId, projectDir);
					}
					if (typeof sessionId === "string") {
						for (const listener of sessionRemovalListenersRef.current) listener(sessionId);
					}
					break;
				}
				case DOMAIN_EVENTS.SESSION_UPDATED: {
					const session = data["session"] as SessionSummaryPayload | undefined;
					if (session) {
						// Before publishing, so display-state listeners see the server's unseen flag.
						syncUnseenFromSummaries([session]);
						if (isLiveSessionState(session.state)) {
							publishSessionState(session.id, session.state, session);
						}
						applySessionUpdated(queryClient, session);
					}
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
						const appended = {
							sessionId,
							lines: lines as Record<string, JsonValue>[],
							...(typeof data["writtenAt"] === "number" ? {writtenAt: data["writtenAt"]} : {}),
						};
						const firstLine = applySessionLinesAppended(queryClient, sessionId, appended);
						if (firstLine !== null) startLiveAppendJourneys(e, appended, firstLine);
					}
					// An already-running session emits this event as it works; the
					// active-sessions query only refetches on lifecycle events, so
					// patch it here to keep the /active page and sidebar live.
					if (typeof sessionId === "string") applySessionActivity(queryClient, sessionId);
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
						publishSessionState(sessionId, "working");
						void queryClient.invalidateQueries({
							queryKey: sessionQueryKeys.transcript(sessionId),
						});
					}
					// A prompt re-stamps the session's terminal pane after a resume.
					invalidateTerminalPlacements(queryClient);
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
				case DOMAIN_EVENTS.SESSION_HOOK_CONTEXT_CHANGED: {
					dispatch({
						type: "SSE_EVENT",
						eventType: e.type,
						data,
						timestamp: Date.now(),
					});
					break;
				}
				case DOMAIN_EVENTS.SESSION_TOOL_PENDING: {
					const sessionId = data["sessionId"];
					const toolName = data["toolName"];
					if (typeof sessionId === "string") {
						publishSessionState(
							sessionId,
							toolName === "AskUserQuestion" || toolName === "ExitPlanMode" ? "waiting" : "working",
						);
					}
					dispatch({
						type: "SSE_EVENT",
						eventType: e.type,
						data,
						timestamp: Date.now(),
					});
					break;
				}
				case DOMAIN_EVENTS.SESSION_TOOL_FAILED: {
					const sessionId = data["sessionId"];
					if (typeof sessionId === "string") publishSessionState(sessionId, "working");
					dispatch({
						type: "SSE_EVENT",
						eventType: e.type,
						data,
						timestamp: Date.now(),
					});
					break;
				}
				case DOMAIN_EVENTS.SESSION_COMPACTING: {
					const sessionId = data["sessionId"];
					if (typeof sessionId === "string" && data["trigger"] === "manual") {
						publishSessionState(sessionId, "working");
					}
					dispatch({
						type: "SSE_EVENT",
						eventType: e.type,
						data,
						timestamp: Date.now(),
					});
					break;
				}
				case DOMAIN_EVENTS.SESSION_COMPACTED: {
					const sessionId = data["sessionId"];
					if (typeof sessionId === "string" && data["reason"] === "manual") {
						publishSessionState(sessionId, "idle");
					}
					dispatch({
						type: "SSE_EVENT",
						eventType: e.type,
						data,
						timestamp: Date.now(),
					});
					break;
				}
				case DOMAIN_EVENTS.MESSAGE_DISPLAYED: {
					const sessionId = data["sessionId"];
					if (typeof sessionId === "string") publishSessionState(sessionId, "working");
					break;
				}
				case DOMAIN_EVENTS.SUBAGENT_STARTED:
				case DOMAIN_EVENTS.SUBAGENT_STOPPED:
				case DOMAIN_EVENTS.NOTIFICATION: {
					dispatch({
						type: "SSE_EVENT",
						eventType: e.type,
						data,
						timestamp: Date.now(),
					});
					if (e.type === DOMAIN_EVENTS.SUBAGENT_STARTED || e.type === DOMAIN_EVENTS.SUBAGENT_STOPPED) {
						const sessionId = data["sessionId"];
						if (typeof sessionId === "string") {
							void queryClient.invalidateQueries({
								queryKey: sessionQueryKeys.subagents(sessionId),
							});
							if (e.type === DOMAIN_EVENTS.SUBAGENT_STOPPED) {
								void queryClient.invalidateQueries({
									queryKey: sessionQueryKeys.transcript(sessionId),
								});
							}
						}
						void queryClient.invalidateQueries({
							predicate: (query) => query.queryKey[0] === "projects" && query.queryKey[2] === "subagents",
						});
					}
					break;
				}
				case DOMAIN_EVENTS.SUBAGENTS_SNAPSHOT: {
					dispatch({
						type: "SSE_EVENT",
						eventType: e.type,
						data,
						timestamp: Date.now(),
					});
					break;
				}
				case DOMAIN_EVENTS.SESSION_STARTED:
				case DOMAIN_EVENTS.SESSION_ENDED: {
					if (e.type === DOMAIN_EVENTS.SESSION_ENDED) {
						const sessionId = data["sessionId"];
						if (typeof sessionId === "string") publishSessionState(sessionId, "idle");
						void queryClient.invalidateQueries({queryKey: sessionQueryKeys.all()});
					}
					invalidateActiveSessions(queryClient);
					invalidateTerminalPlacements(queryClient);
					break;
				}
				case DOMAIN_EVENTS.SESSION_CWD_CHANGED: {
					// Sessions are keyed by project (cwd) — when a session moves to a
					// new cwd the active-sessions sidebar query must refetch so the
					// session re-homes under the new project entry. Project lists are
					// also invalidated because a session leaving a project changes
					// that project's "has-active-session" status.
					invalidateActiveSessions(queryClient);
					void queryClient.invalidateQueries({queryKey: ["projects"]});
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
					const task = data["task"] as {projectDir?: string} | undefined;
					if (task && typeof task.projectDir === "string") {
						applyTaskChanged(queryClient, task.projectDir);
					} else {
						void queryClient.invalidateQueries({queryKey: ["tasks"]});
					}
					break;
				}
				case DOMAIN_EVENTS.TASK_CREATED:
				case DOMAIN_EVENTS.TASK_COMPLETED: {
					void queryClient.invalidateQueries({queryKey: ["tasks"]});
					break;
				}
				case DOMAIN_EVENTS.APPROVAL_CHANGED: {
					const approval = data["approval"] as PendingApprovalPayload | undefined;
					if (approval) {
						publishSessionState(approval.sessionId, "waiting");
						applyApprovalChanged(queryClient, approval);
					}
					break;
				}
				case DOMAIN_EVENTS.APPROVAL_RESOLVED: {
					const sessionId = data["sessionId"];
					if (typeof sessionId === "string") {
						publishSessionState(sessionId, "working");
						applyApprovalResolved(queryClient, sessionId);
					}
					break;
				}
				case DOMAIN_EVENTS.NOTIFICATION_ADDED: {
					const notification = data["notification"] as NotificationEntryPayload | undefined;
					if (notification) {
						applyNotificationAdded(queryClient, notification);
					}
					break;
				}
				case DOMAIN_EVENTS.NOTIFICATION_CLEARED: {
					const id = data["id"];
					const all = data["all"];
					applyNotificationCleared(queryClient, {
						...(typeof id === "string" ? {id} : {}),
						...(typeof all === "boolean" ? {all} : {}),
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
				case DOMAIN_EVENTS.REVIEW_OFFERED: {
					const sessionId = data["sessionId"];
					if (typeof sessionId === "string") {
						for (const listener of reviewOfferListenersRef.current) listener(sessionId);
					}
					break;
				}
				case DOMAIN_EVENTS.JOBS_CHANGED: {
					void queryClient.invalidateQueries({queryKey: ["jobs"]});
					break;
				}
				default:
					break;
			}
		}

		function handleHerdrEvent() {
			void queryClient.invalidateQueries({queryKey: ["herdr", "panes"]});
			void queryClient.invalidateQueries({queryKey: ["herdr", "workspaces"]});
			void queryClient.invalidateQueries({queryKey: ["terminal", "placements"]});
			void queryClient.invalidateQueries({queryKey: sessionQueryKeys.all()});
		}

		// SSE reconnection safety: with staleTime: Infinity, data is never
		// "stale" so refetchOnReconnect won't refetch after a disconnect.
		// On reconnect, catch up on the events missed during the gap. Every tab of the
		// origin shares one stream, which leaves the others of Chrome's six connections free.
		return openSharedEventSource("/api/events", {
			attach(es) {
				for (const eventType of LIFECYCLE_EVENT_TYPES) {
					es.addEventListener(eventType, handleLifecycleEvent);
				}
				for (const eventType of DOMAIN_EVENT_TYPES) {
					es.addEventListener(eventType, handleDomainEvent);
				}
				for (const eventType of HERDR_EVENT_TYPES) {
					es.addEventListener(eventType, handleHerdrEvent);
				}
				es.addEventListener(SSE_EVENTS.STATUSLINE_UPDATED, handleStatuslineEvent);
			},
			onReconnected: () => {
				applyReconnected(queryClient);
			},
		});
	}, [dispatch, queryClient]);

	const contextValue: ClaudeEventsContextValue = useMemo(
		() => ({
			state,
			subscribeStatusline,
			subscribeSessionStates,
			subscribeReviewOffers,
			subscribeSessionRemovals,
			dismissHookSchemaDrift,
		}),
		[
			state,
			subscribeStatusline,
			subscribeSessionStates,
			subscribeReviewOffers,
			subscribeSessionRemovals,
			dismissHookSchemaDrift,
		],
	);

	return <ClaudeEventsContext.Provider value={contextValue}>{children}</ClaudeEventsContext.Provider>;
}
