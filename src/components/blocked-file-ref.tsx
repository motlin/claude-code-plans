import type {ReactNode, RefCallback} from "react";

import
{
	DISABLED_REASON_ATTR,
	DISABLED_REASON_WRAPPER_ATTR,
	FILE_REF_BLOCK_REASONS,
	type FileRefBlock,
	fileRefReasonId,
} from "../lib/file-refs";
import {BLOCKED_WRAPPER_CLASS} from "./user-code-classes";
import {useReasonTooltip} from "./use-reason-tooltip";

/**
 * Upstream's `Jr` (c856385e2): a blocked file ref's content inside the focusable disabled-reason wrapper, described
 * by its hidden reason and showing it in a tooltip. A missing ref also carries the hidden focus-slot span.
 */
export function BlockedFileRef({
	path,
	block,
	focusSlot,
	children,
}: {
	path: string;
	block: FileRefBlock;
	focusSlot?: RefCallback<HTMLElement> | undefined;
	children: ReactNode;
})
{
	const reasonTooltip = useReasonTooltip();
	const id = fileRefReasonId(path, block);
	return (
		<>
			<span
				// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- upstream's disabled-reason wrapper is a tab stop that reaches its reason tooltip
				tabIndex={0}
				{...
				{
					[DISABLED_REASON_WRAPPER_ATTR]: "",
				}}
				aria-describedby={id}
				className={BLOCKED_WRAPPER_CLASS}
				{...reasonTooltip.handlers}
			>
				{children}
				{block === "missing" && <span ref={focusSlot} hidden />}
				<span
					id={id}
					hidden
					{...
					{
						[DISABLED_REASON_ATTR]: "",
					}}
				>
					{FILE_REF_BLOCK_REASONS[block]}
				</span>
			</span>
			{reasonTooltip.tooltip}
		</>
	);
}
