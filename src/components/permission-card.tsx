import {Loader2} from "lucide-react";
import {useCallback, useEffect, useState} from "react";

import {dockKeyAllowed} from "../lib/dock-keys";
import {permissionDecisionForKey, type PermissionDecision} from "../lib/permission-card";
import {APPROVAL_CARD_TITLE, ApprovalActionButton, ApprovalCardShell} from "./approval-card";
import {Shortcut} from "./ui/shortcut";

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
		<ApprovalCardShell
			label="Permission request: run"
			digits={2}
			body={
				<>
					<span data-permission-title data-approval-card-title className={APPROVAL_CARD_TITLE}>
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
				</>
			}
			actions={
				<>
					<ApprovalActionButton variant="secondary" disabled={!enabled} onClick={() => void decide("deny")}>
						Deny
						<Shortcut keys="1" className="pointer-coarse:hidden" />
						<Shortcut keys="esc" className="pointer-coarse:hidden" />
					</ApprovalActionButton>
					<ApprovalActionButton variant="primary" disabled={!enabled} onClick={() => void decide("allow")}>
						{submitting && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
						Allow once
						<Shortcut keys="2" className="pointer-coarse:hidden" />
						<Shortcut keys="cmd+enter" className="pointer-coarse:hidden" />
					</ApprovalActionButton>
				</>
			}
		/>
	);
}
