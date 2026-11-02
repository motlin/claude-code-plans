import {useState} from "react";

import {capDetails} from "../lib/hook-prompt-block";
import {ErrorDetails, MARKER_ROOT_CLASS, MarkerWarningIcon} from "./api-error-card";
import {ApprovalActionButton} from "./approval-card";
import {ErrorCardShell} from "./error-card-shell";

const HINT_FALLBACK = "A UserPromptSubmit hook stopped this prompt before it reached Claude.";

/**
 * Entries whose Edit prompt already filled the composer (upstream's module Set
 * `BX`): the button stays hidden across remounts until a reload.
 */
const editedEntries = new Set<string>();

/**
 * Upstream's "A hook blocked your prompt" card (cbb2d9547 `VX`), drawn when the
 * blocked prompt is the transcript's last entry. View details shows the
 * original prompt; Edit prompt hands it to the composer and hides once that
 * worked (`onEditPrompt` returns false when the composer refused it).
 */
export function HookBlockedPromptCard({
	entryKey,
	reason,
	originalPrompt,
	onEditPrompt,
}: {
	/** Identifies the entry for the once-per-entry edited memory. */
	entryKey: string;
	reason: string;
	originalPrompt?: string | undefined;
	onEditPrompt?: ((text: string) => boolean) | undefined;
})
{
	const [edited, setEdited] = useState(() => editedEntries.has(entryKey));
	const details =
		originalPrompt === undefined
			? undefined
			:
				{
					body: capDetails(originalPrompt),
					raw: capDetails(originalPrompt),
				};
	const action =
		originalPrompt !== undefined && onEditPrompt !== undefined && !edited ? (
			<ApprovalActionButton
				variant="primary"
				onClick={() =>
				{
					if (!onEditPrompt(originalPrompt)) return;
					editedEntries.add(entryKey);
					setEdited(true);
				}}
			>
				Edit prompt
			</ApprovalActionButton>
		) : undefined;
	return (
		<ErrorCardShell
			data={
			{
				"data-hook-blocked-card": "",
			}}
			headline="A hook blocked your prompt"
			hint={capDetails(reason.trim()) || HINT_FALLBACK}
			icon="warning"
		>
			{(details !== undefined || action !== undefined) && (
				<ErrorDetails details={details} inCard actions={action} />
			)}
		</ErrorCardShell>
	);
}

/**
 * Upstream's "Prompt blocked by a hook" marker (cbb2d9547 `RX`), drawn once
 * anything follows the blocked prompt. View details shows the hook's reason.
 */
export function HookBlockedPromptMarker({reason}: {reason: string})
{
	const trimmed = capDetails(reason.trim());
	return (
		<div data-hook-blocked-marker="" className={MARKER_ROOT_CLASS}>
			<div className="flex max-w-full min-w-0 items-center gap-1.25 select-text">
				<MarkerWarningIcon />
				<span className="min-w-0 text-body text-secondary break-words">Prompt blocked by a hook</span>
			</div>
			{trimmed !== "" && (
				<ErrorDetails
					details={
					{
						body: trimmed,
						raw: trimmed,
					}}
					inCard={false}
				/>
			)}
		</div>
	);
}
