import type {ReactNode} from "react";

import {useDensity} from "../ui/density";

/** Upstream cds `Counter` (xs): 18px pill, 11px medium, neutral fill. */
function Counter({count, inset}: {count: number; inset: boolean}) {
	return (
		<span
			data-testid="customize-counter"
			className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-fill-ghost-hover ${inset ? "px-[5.4px]" : "px-0"} text-[11px]/[17px] font-medium text-secondary tabular-nums`}
		>
			{count}
		</span>
	);
}

interface SectionHeaderProps {
	id: string;
	title: string;
	count: number;
	/** Forces comfortable `gap-xs` (8px); otherwise the density scope decides (compact keeps 4px). */
	comfortable?: boolean;
	/** Upstream's Yours counter in unified search drops the horizontal padding. */
	counterInset?: boolean;
	/** Trailing control pushed to the end of the header, e.g. "Show all". */
	trailing?: ReactNode;
}

/** Upstream `yours-section-*-header`: 15/20 semibold H3 followed by a Counter. */
export function SectionHeader({id, title, count, comfortable, counterInset = true, trailing}: SectionHeaderProps) {
	const density = useDensity();
	const gap = (comfortable ?? density === "comfortable") ? "gap-2" : "gap-1";
	return (
		<div id={id} className={`flex min-h-7 items-center ${gap}`}>
			<h3 className="m-0 truncate text-[15px]/[20px] font-[580] text-primary">{title}</h3>
			<Counter count={count} inset={counterInset} />
			{trailing !== undefined && <div className="ms-auto flex min-w-0 shrink items-center">{trailing}</div>}
		</div>
	);
}
