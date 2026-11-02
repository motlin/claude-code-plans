import type React from "react";
import {useCallback, useId, useState} from "react";

/** Upstream clamps long bubbles at 16rem and fades their last 3rem with a mask, not an overlay. */
const TRUNCATED_CLAMP_CLASSES =
	"max-h-[16rem] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_calc(100%-3rem),transparent)]";
const TRUNCATE_THRESHOLD_PX = 256;

/**
 * Upstream's UserMessage body: `div#id` (no class at rest, the clamp only while collapsed) >
 * `div.cds-user-message-body`, with the Show more button as the next sibling, a flex item of the bubble.
 */
export function TruncatedContent({children}: {children: React.ReactNode})
{
	const id = useId();
	const [isTruncated, setIsTruncated] = useState(false);
	const [expanded, setExpanded] = useState(false);

	const measureRef = useCallback((node: HTMLDivElement | null) =>
	{
		if (node) setIsTruncated(node.scrollHeight > TRUNCATE_THRESHOLD_PX);
	}, []);

	return (
		<>
			<div id={id} ref={measureRef} className={isTruncated && !expanded ? TRUNCATED_CLAMP_CLASSES : ""}>
				<div className="cds-user-message-body">{children}</div>
			</div>
			{isTruncated && (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() =>
					{
						setExpanded((value) => !value);
					}}
					className="self-start h-5 cursor-pointer rounded-r4 px-1.5 text-caption font-normal text-primary transition-colors hover:bg-alpha-1"
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
		</>
	);
}
