import {Loader2} from "lucide-react";
import {useCallback, useEffect, useState, type ReactNode} from "react";

import {dockKeyAllowed} from "../lib/dock-keys";
import {permissionDecisionForKey, type PermissionDecision, type PermissionTitle} from "../lib/permission-card";
import {PERSISTENT_ALLOW_LABELS, type PersistentAllowKind} from "../lib/permission-suggestions";
import {APPROVAL_CARD_TITLE, ApprovalActionButton, ApprovalCardShell} from "./approval-card";
import {ReadOnlyAnswerHint} from "./terminal-writes-tip";
import {Shortcut} from "./ui/shortcut";

/**
 * The tool-permission card, drawn inline as claude.ai/code's approvals:
 * "Allow Claude to <action> <meta>?", the detail block, and [Deny Esc] … [Allow once ⌘⏎],
 * then the persistent option ("Always allow" / "Allow for this session") when
 * the CLI's dialog offers one.
 * Keys act while the card is focused, nothing is focused, or the composer is empty.
 */
export function PermissionCard({
	title,
	detail,
	canAnswer,
	persistentAllow = null,
	onDecision,
	footer,
}: {
	title: PermissionTitle;
	detail: string | null;
	/** False without a live herdr pane that accepts writes. */
	canAnswer: boolean;
	/** The dialog's persistent allow option, from the PermissionRequest hook; null hides it. */
	persistentAllow?: PersistentAllowKind | null;
	onDecision: (decision: PermissionDecision) => Promise<void>;
	/** Rendered under the actions; the session page passes the notify tip. */
	footer?: ReactNode;
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
		if (!enabled) return undefined;
		function onKeyDown(event: KeyboardEvent) {
			if (event.defaultPrevented || !dockKeyAllowed(event.target)) return;
			const decision = permissionDecisionForKey(event);
			if (decision === null) return;
			event.preventDefault();
			void decide(decision);
		}
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [enabled, decide]);

	return (
		<ApprovalCardShell
			label={"action" in title ? `Permission request: ${title.action}` : "Permission request"}
			footer={footer}
			presentation="card"
			body={
				<div className="flex flex-col gap-[10px]">
					<span data-permission-title data-approval-card-title className={APPROVAL_CARD_TITLE}>
						<PermissionTitleText title={title} />
					</span>
					<div className="flex flex-col gap-[12px] empty:hidden">
						{detail !== null && (
							<div
								data-permission-detail
								data-approval-value
								className="rounded-r4 bg-alpha-1 px-3 py-2 font-mono text-[12px]/[17px] break-words whitespace-pre-wrap text-secondary select-text [unicode-bidi:plaintext]"
							>
								{detail}
							</div>
						)}
						{!canAnswer && <ReadOnlyAnswerHint className="text-footnote text-secondary" />}
						{error && <p className="text-footnote text-extended-pink">{error}</p>}
					</div>
				</div>
			}
			actions={
				<>
					<ApprovalActionButton variant="secondary" disabled={!enabled} onClick={() => void decide("deny")}>
						Deny
						<Shortcut keys="esc" className="pointer-coarse:hidden" />
					</ApprovalActionButton>
					<ApprovalActionButton variant="primary" disabled={!enabled} onClick={() => void decide("allow")}>
						{submitting && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
						Allow once
						<Shortcut keys="cmd+enter" className="pointer-coarse:hidden" />
					</ApprovalActionButton>
					{persistentAllow !== null && (
						<ApprovalActionButton
							variant="secondary"
							disabled={!enabled}
							onClick={() => void decide("always")}
						>
							{PERSISTENT_ALLOW_LABELS[persistentAllow]}
						</ApprovalActionButton>
					)}
				</>
			}
		/>
	);
}

const TITLE_PART = "text-primary [unicode-bidi:plaintext]";

/** Upstream's title: the action and meta are their own bidi-isolated spans inside the approval value. */
function PermissionTitleText({title}: {title: PermissionTitle}) {
	if (!("action" in title)) return <span className={TITLE_PART}>{title.heading}</span>;
	return (
		<span className="min-w-0 break-words">
			<span data-approval-value>
				Allow Claude to <span className={TITLE_PART}>{title.action}</span>
				{title.meta !== null && (
					<>
						{" "}
						<span className={TITLE_PART}>{title.meta}</span>
					</>
				)}
				?
			</span>
		</span>
	);
}
