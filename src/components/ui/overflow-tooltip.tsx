import type {ReactNode} from "react";

import {Tooltip} from "./tooltip";

/** Upstream's OverflowTooltip text classes: one clipped, ellipsed line. */
const OVERFLOW_TEXT_CLASS = "block overflow-x-clip text-ellipsis whitespace-nowrap min-w-0";

/** Whether the anchored text is clipped, the only case its tooltip opens (upstream's lazy OverflowTooltip). */
function textOverflows(anchor: HTMLElement): boolean
{
	const text = anchor.firstElementChild;
	return text !== null && text.scrollWidth > text.clientWidth;
}

/** Upstream's cds OverflowTooltip: a one-line clipped text span whose full text shows in a tooltip only when clipped. */
export function OverflowTooltip({
	children,
	className,
	textClassName = "",
	textData,
}: {
	children: ReactNode;
	/** The tooltip anchor's classes, e.g. its flex sizing. */
	className: string;
	/** Classes added after the clip classes on the text span. */
	textClassName?: string;
	/** A `data-*` marker set on the text span. */
	textData?: `data-${string}`;
})
{
	return (
		<Tooltip portal content={children} openWhen={textOverflows} className={className}>
			<span
				className={textClassName === "" ? OVERFLOW_TEXT_CLASS : `${OVERFLOW_TEXT_CLASS} ${textClassName}`}
				{...(textData === undefined
					? {}
					:
						{
							[textData]: "",
						})}
			>
				{children}
			</span>
		</Tooltip>
	);
}
