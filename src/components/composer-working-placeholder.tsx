import {useLayoutEffect, useRef, useState} from "react";

import {pickWorkingPlaceholder, workingPlaceholder} from "../lib/working-placeholder";

/**
 * The working placeholder's visible text: the full sentence, measured on one line in a zero-height box, swaps
 * to the compact form whenever it is wider than the overlay's content box.
 */
export function WorkingPlaceholderText({isMac}: {isMac: boolean}) {
	const boxRef = useRef<HTMLDivElement>(null);
	const measureRef = useRef<HTMLSpanElement>(null);
	const [fits, setFits] = useState(true);
	const full = workingPlaceholder(isMac);
	useLayoutEffect(() => {
		const box = boxRef.current;
		const measure = measureRef.current;
		if (box === null || measure === null) return undefined;
		const update = () => {
			setFits(measure.scrollWidth <= box.clientWidth);
		};
		update();
		if (typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver(update);
		observer.observe(box);
		return () => {
			observer.disconnect();
		};
	}, [full]);
	return (
		<>
			<div ref={boxRef} className="invisible h-0 overflow-hidden">
				<span ref={measureRef} className="inline-block whitespace-pre">
					{full}
				</span>
			</div>
			<span data-testid="composer-placeholder-text">{pickWorkingPlaceholder({fits, isMac})}</span>
		</>
	);
}
