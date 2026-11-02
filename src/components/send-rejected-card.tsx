import {useState} from "react";
import {Copy} from "lucide-react";

import {sendRejectedCopy} from "../lib/send-rejection";
import {ApprovalActionButton} from "./approval-card";
import {ErrorCardShell} from "./error-card-shell";
import * as Collapsible from "./ui/collapsible";
import type {SendRejection} from "./use-live-herdr-prompt";

const ICON_BUTTON =
	"inline-flex cursor-pointer items-center justify-center text-ink-muted hover:bg-alpha-2 hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

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
	const [detailsOpen, setDetailsOpen] = useState(true);
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
			<Collapsible.Root open={detailsOpen} onOpenChange={setDetailsOpen} className="flex flex-col self-stretch">
				<div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-5 gap-y-2 px-3 pb-3 pt-2">
					<Collapsible.Trigger
						caretPosition="end"
						className="shrink-0 whitespace-nowrap text-footnote text-secondary hover:text-primary"
					>
						<span className="text-current-control">View details</span>
					</Collapsible.Trigger>
					{copy.retry && (
						<div className="ms-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
							<ApprovalActionButton variant="primary" onClick={onRetry}>
								Try again
							</ApprovalActionButton>
						</div>
					)}
				</div>
				<Collapsible.Panel className="contain-inline-size">
					<div className="border-t border-[var(--card-outline)] p-3">
						<div className="flex flex-col gap-2">
							<div className="relative flex min-h-8 flex-col gap-1.5 rounded-r7 bg-alpha-1 py-1.5 ps-2 pe-[34px] text-[12px]/[15px] text-secondary">
								<span
									data-send-rejected-message=""
									className="whitespace-pre-wrap break-words select-text"
								>
									{rejection.message}
								</span>
								<span className="absolute top-1 end-1 flex">
									<button
										type="button"
										aria-label="Copy details"
										onClick={() => void navigator.clipboard.writeText(rejection.message)}
										className={`${ICON_BUTTON} size-6 rounded-r5`}
									>
										<Copy aria-hidden="true" className="size-3.5" />
									</button>
								</span>
							</div>
						</div>
					</div>
				</Collapsible.Panel>
			</Collapsible.Root>
		</ErrorCardShell>
	);
}
