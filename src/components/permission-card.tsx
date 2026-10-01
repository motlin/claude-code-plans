import {Loader2} from "lucide-react";
import {useCallback, useEffect, useState} from "react";

import {dockKeyAllowed} from "../lib/dock-keys";
import {permissionDecisionForKey, type PermissionDecision} from "../lib/permission-card";
import {Shortcut} from "./ui/shortcut";

const ACTION_BUTTON =
	"inline-flex h-6 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-r5 px-2 text-[13px]/[19px] whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-50 [&_kbd]:text-[11px] @max-[500px]/approval-dock:w-full";

/**
 * The tool-permission card docked above the composer, copied from
 * claude.ai/code: "Allow Claude to run …?", the command block, and
 * [Deny 1 Esc] … [Allow once 2 ⌘⏎]. Keys act while the card is focused,
 * nothing is focused, or the composer is empty.
 */
export function PermissionCard({
	title,
	command,
	canAnswer,
	onDecision,
}: {
	title: string;
	command: string | null;
	/** False without a live herdr pane that accepts writes. */
	canAnswer: boolean;
	onDecision: (decision: PermissionDecision) => Promise<void>;
}) {
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const enabled = canAnswer && !submitting;

	const decide = useCallback(
		async (decision: PermissionDecision) => {
			setError(null);
			setSubmitting(true);
			try {
				await onDecision(decision);
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to answer the permission request");
			} finally {
				setSubmitting(false);
			}
		},
		[onDecision],
	);

	useEffect(() => {
		if (!enabled) return;
		function onKeyDown(event: KeyboardEvent) {
			if (event.defaultPrevented || !dockKeyAllowed(event.target)) return;
			const decision = permissionDecisionForKey(event);
			if (decision === null) return;
			event.preventDefault();
			void decide(decision);
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [enabled, decide]);

	return (
		<div className="@container/approval-dock [--approval-dock-floor:144px] @max-[500px]/approval-dock:[--approval-dock-floor:208px]">
			<div
				data-approval-card-root
				data-approval-card-digits="2"
				role="group"
				aria-label="Permission request: run"
				tabIndex={0}
				className="relative isolate flex max-h-[60vh] flex-col gap-6 rounded-r7 bg-surface-popover p-3 text-[13px]/[19px] text-primary shadow-[var(--approval-card-shadow)]"
			>
				<div className="-mx-3 -mt-1 -mb-2 flex min-h-0 flex-col gap-2.5 overflow-y-auto px-3 pt-1 pb-2">
					<span data-permission-title className="flex min-h-6 items-center text-[13px]/[19px] font-bold">
						{title}
					</span>
					{command !== null && (
						<div
							data-approval-value
							className="rounded-r4 bg-alpha-1 px-3 py-2 font-mono text-[12px]/[17px] break-words whitespace-pre-wrap text-secondary select-text [unicode-bidi:plaintext]"
						>
							{command}
						</div>
					)}
					{!canAnswer && <p className="text-footnote text-secondary">Answer in the terminal</p>}
					{error && <p className="text-footnote text-extended-pink">{error}</p>}
				</div>
				<div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 @max-[500px]/approval-dock:flex-col">
					<button
						type="button"
						disabled={!enabled}
						onClick={() => void decide("deny")}
						className={`${ACTION_BUTTON} border border-strong text-primary hover:bg-alpha-2`}
					>
						Deny
						<Shortcut keys="1" className="pointer-coarse:hidden" />
						<Shortcut keys="esc" className="pointer-coarse:hidden" />
					</button>
					<button
						type="button"
						disabled={!enabled}
						onClick={() => void decide("allow")}
						className={`${ACTION_BUTTON} bg-primary font-medium text-surface-1 [--shortcut-cap-ink:currentColor] hover:bg-primary/80`}
					>
						{submitting && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
						Allow once
						<Shortcut keys="2" className="pointer-coarse:hidden" />
						<Shortcut keys="cmd+enter" className="pointer-coarse:hidden" />
					</button>
				</div>
			</div>
		</div>
	);
}
