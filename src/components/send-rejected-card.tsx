import {useState} from "react";
import {ChevronRight, Copy, TriangleAlert, X} from "lucide-react";

import {sendRejectedCopy} from "../lib/send-rejection";
import {ApprovalActionButton} from "./approval-card";
import type {SendRejection} from "./use-live-herdr-prompt";

const ICON_BUTTON =
	"inline-flex cursor-pointer items-center justify-center text-ink-muted hover:bg-alpha-2 hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/**
 * Upstream's composer-dock session-error card (`Cn`) for a rejected send: the generic
 * "Something went wrong" copy, Dismiss, Try again, and the raw message open in the details.
 */
export function SendRejectedCard({
	rejection,
	onRetry,
	onDismiss,
}: {
	rejection: SendRejection;
	onRetry: () => void;
	onDismiss: () => void;
}) {
	const [detailsOpen, setDetailsOpen] = useState(true);
	const copy = sendRejectedCopy({nonResendable: rejection.nonResendable});

	return (
		<div
			data-testid="send-rejected-card"
			className="card-outline flex w-fit min-w-[min(480px,100%)] max-w-full flex-col overflow-clip rounded-r7 select-text text-[13px]/[19px]"
		>
			<span role="alert" className="sr-only">
				{`${copy.title} ${copy.body}`}
			</span>
			<div className="flex items-center gap-3 bg-alpha-1 px-3 py-2">
				<TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-danger-000" />
				<span className="min-w-0 grow text-primary break-words">{copy.title}</span>
				<span className="-my-1 -me-1 flex shrink-0">
					<button
						type="button"
						aria-label="Dismiss"
						onClick={onDismiss}
						className={`${ICON_BUTTON} size-5 rounded-r4`}
					>
						<X aria-hidden="true" className="size-3" />
					</button>
				</span>
			</div>
			<div className="flex flex-col gap-3 px-3 pt-3 pb-2">
				<span className="text-secondary whitespace-pre-line break-words">{copy.body}</span>
			</div>
			<div className="flex flex-col self-stretch">
				<div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-5 gap-y-2 px-3 pb-3 pt-2">
					<button
						type="button"
						aria-expanded={detailsOpen}
						onClick={() => {
							setDetailsOpen((open) => !open);
						}}
						className="inline-flex cursor-pointer items-center gap-1.5 rounded-md text-[12px]/[15px] text-secondary hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
					>
						View details
						<ChevronRight
							aria-hidden="true"
							className={`size-4 transition-transform motion-reduce:transition-none ${detailsOpen ? "rotate-90" : ""}`}
						/>
					</button>
					{copy.retry && (
						<div className="ms-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
							<ApprovalActionButton variant="primary" onClick={onRetry}>
								Try again
							</ApprovalActionButton>
						</div>
					)}
				</div>
				{detailsOpen && (
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
				)}
			</div>
		</div>
	);
}
