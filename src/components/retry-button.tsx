import {type ReactNode, useState} from "react";

import {ApprovalActionButton, type ApprovalActionSize, type ApprovalActionVariant} from "./approval-action-button";

/**
 * Upstream's RetryButton (`Ka`): a busy-capable cds Button labelled "Try again". `onRetry` resolves
 * true when the retry ended the same way it started, and the sibling sr-only status then announces
 * `failedLabel` again, keyed by the attempt so a repeat announcement is not swallowed.
 */
export function RetryButton({
	size = "default",
	variant = "secondary",
	busy,
	busyLabel,
	failedLabel,
	onRetry,
	children,
}: {
	size?: ApprovalActionSize;
	variant?: ApprovalActionVariant;
	busy: boolean;
	busyLabel: string;
	failedLabel: string;
	onRetry: () => Promise<boolean>;
	children?: ReactNode;
})
{
	const [repeatedFailures, setRepeatedFailures] = useState(0);
	return (
		<>
			<ApprovalActionButton
				variant={variant}
				size={size}
				busy={busy}
				busyLabel={busyLabel}
				onClick={() =>
				{
					void onRetry().then((unchanged) =>
					{
						if (unchanged) setRepeatedFailures((count) => count + 1);
					});
				}}
			>
				{children ?? "Try again"}
			</ApprovalActionButton>
			<span role="status" data-retry-status className="sr-only">
				{repeatedFailures > 0 && <span key={repeatedFailures}>{failedLabel}</span>}
			</span>
		</>
	);
}
