import type {ReactNode} from "react";
import {useShrinkwrap} from "../hooks/use-shrinkwrap";
import {USER_BUBBLE_CLASS} from "./user-bubble";

/**
 * A user bubble whose edge hugs its widest wrapped line, as upstream's UserMessage merges the shrinkwrap ref
 * (`an()`) onto its bubble div.
 */
export function UserBubbleBox({className = USER_BUBBLE_CLASS, children}: {className?: string; children: ReactNode}) {
	const ref = useShrinkwrap();
	return (
		<div ref={ref} className={className}>
			{children}
		</div>
	);
}
