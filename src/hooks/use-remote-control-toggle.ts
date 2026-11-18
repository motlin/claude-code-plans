import {useQuery} from "@tanstack/react-query";
import {useEffect, useSyncExternalStore} from "react";

import {HerdrRequestError, toggleRemoteControl} from "../lib/api/herdr";
import {sessionOpenInQueryOptions} from "../lib/api/sessions";
import type {RemoteControlState} from "../lib/session-state";
import type {SlashRemoteControl} from "../lib/slash-compact-menu";
import {useToast} from "../components/toast-context";

/*
 * Toggles in flight by session id (upstream `Kf`), kept outside React so a
 * remounted rail still shows the spinner: each holds the requested state until
 * the bridge reaches it or 15 s pass.
 */
const PENDING_TIMEOUT_MS = 15_000;
const pendingToggles = new Map<
	string,
	{
		on: boolean;
		timer: ReturnType<typeof setTimeout> | null;
	}
>();
const pendingListeners = new Set<() => void>();

function notifyPending(): void
{
	for (const listener of pendingListeners) listener();
}

function setPendingToggle(sessionId: string, on: boolean | null): void
{
	const previous = pendingToggles.get(sessionId);
	if (previous?.timer != null) clearTimeout(previous.timer);
	if (on === null) pendingToggles.delete(sessionId);
	else
		pendingToggles.set(
			sessionId,
			{
				on,
				timer: null,
			},
		);
	notifyPending();
}

/** Starts the 15 s give-up once the send has gone through. */
function armPendingTimeout(sessionId: string): void
{
	const pending = pendingToggles.get(sessionId);
	if (pending === undefined) return;
	pending.timer = setTimeout(() =>
	{
		if (pendingToggles.get(sessionId) === pending) setPendingToggle(sessionId, null);
	}, PENDING_TIMEOUT_MS);
}

function subscribePending(listener: () => void): () => void
{
	pendingListeners.add(listener);
	return () =>
	{
		pendingListeners.delete(listener);
	};
}

function usePendingToggle(sessionId: string): boolean | null
{
	return useSyncExternalStore(
		subscribePending,
		() => pendingToggles.get(sessionId)?.on ?? null,
		() => null,
	);
}

const TOGGLE_FAILED = "Couldn’t toggle Remote Control. Try again.";

/**
 * The toggle both the rail row and the grouped "/" menu drive: a send that types `/remote-control` into the pane,
 * pending until the registry's bridge state follows (then a toast), or 15 s pass.
 */
export function useRemoteControlToggle(
	sessionId: string,
	state: RemoteControlState,
	send: (sessionId: string, on: boolean) => Promise<void>,
):
{
	pending: boolean | null;
	onToggle: (on: boolean) => void;
}
{
	const toast = useToast();
	const pending = usePendingToggle(sessionId);
	useEffect(() =>
	{
		// Both surfaces watch the same pending toggle; the first to see it land clears it and toasts.
		if (pending === null || (state === "on") !== pending || pendingToggles.get(sessionId)?.on !== pending) return;
		setPendingToggle(sessionId, null);
		toast(
			{
				kind: "success",
				message: pending ? "Remote Control turned on." : "Remote Control turned off.",
			},
		);
	}, [pending, state, sessionId, toast]);
	const onToggle = (on: boolean) =>
	{
		if (pendingToggles.has(sessionId)) return;
		setPendingToggle(sessionId, on);
		send(sessionId, on).then(
			() =>
			{
				armPendingTimeout(sessionId);
			},
			(error: unknown) =>
			{
				setPendingToggle(sessionId, null);
				toast(
					error instanceof HerdrRequestError && error.status === 409
						?
							{
								kind: "warning",
								message: error.message,
							}
						:
							{
								kind: "error",
								message: TOGGLE_FAILED,
							},
				);
			},
		);
	};
	return {
		pending,
		onToggle,
	};
}

/**
 * Upstream `ICe` for the grouped "/" menu's Remote Control row (`surface: "slash_menu"`): the session's bridge state,
 * a toggle while it can change (not pending, not working), or null when the session has no live pane to type into.
 */
export function useSlashRemoteControl({
	sessionId,
	canToggle,
	working,
	send = toggleRemoteControl,
}: {
	sessionId: string;
	canToggle: boolean;
	working: boolean;
	send?: (sessionId: string, on: boolean) => Promise<void>;
}): SlashRemoteControl | null
{
	// Only a live pane can toggle it, so nothing is fetched for a session without one.
	const remoteControl =
		useQuery(
			{
				...sessionOpenInQueryOptions(sessionId),
				enabled: canToggle,
			},
		).data?.remoteControl ?? null;
	const state = remoteControl?.state ?? "off";
	const {pending, onToggle} = useRemoteControlToggle(sessionId, state, send);
	if (remoteControl === null || !canToggle) return null;
	const on = pending ?? state === "on";
	return {
		on,
		toggle:
			pending !== null || working
				? null
				: () =>
					{
						onToggle(!on);
					},
	};
}
