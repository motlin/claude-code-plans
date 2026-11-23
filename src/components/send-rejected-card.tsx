import {sendRejectedCopy} from "../lib/send-rejection";
import {ErrorDetails} from "./error-details";
import {ApprovalActionButton} from "./approval-action-button";
import {ErrorCardShell} from "./error-card-shell";
import type {SendRejection} from "./use-live-herdr-prompt";

/**
 * Upstream's composer-dock session-error card (`Cn`) for a rejected send: the generic
 * "Something went wrong" copy on the shared error card shell, Dismiss, Try again, and the raw
 * message open in the details.
 */
export function SendRejectedCard({
	rejection,
	onRetry,
	onDismiss,
	data,
}: {
	rejection: SendRejection;
	onRetry: () => void;
	onDismiss: () => void;
	/** Extra data attributes for the card root, e.g. `data-start-failed` on the home dock's failed-start card. */
	data?: Readonly<Record<`data-${string}`, string>>;
})
{
	const copy = sendRejectedCopy(
		{
			nonResendable: rejection.nonResendable,
		},
	);

	return (
		<ErrorCardShell
			data={
			{
				...data,
				"data-testid": "send-rejected-card",
			}}
			headline={copy.title}
			hint={copy.body}
			icon="warning"
			announce="alert"
			onDismiss={onDismiss}
		>
			<ErrorDetails
				details={
				{
					body: rejection.message,
					raw: rejection.message,
				}}
				inCard
				defaultOpen
				actions={
					copy.retry ? (
						<ApprovalActionButton variant="primary" onClick={onRetry}>
							Try again
						</ApprovalActionButton>
					) : undefined
				}
			/>
		</ErrorCardShell>
	);
}
