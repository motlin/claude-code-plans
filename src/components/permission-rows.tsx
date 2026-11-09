import {Fragment, useEffect, useId, useRef, useState} from "react";

import type {PermissionRow, PermissionRowGroup, PermissionRowLeaf} from "../lib/permission-rows";
import * as Collapsible from "./ui/collapsible";

/*
 * Upstream's permission card rows list (claude.ai/code ceabdc31b `x`/`S`/`C`/`T`/`E`/`O`): a labelled list of
 * key/value grid rows, groups as open-by-default Collapsibles, and long values clamped behind Show more.
 */

const LIST_CLASS = "flex flex-col gap-0.75";
const LIST_GAPS_CLASS = `${LIST_CLASS} @max-[420px]:gap-2`;
const LEAF_CLASS = "grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-baseline gap-x-3 @max-[420px]:grid-cols-1";

export const PERMISSION_ROWS_LABEL = "What Claude sent";

export function PermissionRowsList({
	rows,
	foldable = true,
	clamp = foldable,
}: {
	rows: readonly PermissionRow[];
	/** Groups fold (upstream's Collapsible); false draws them as a plain label and list. */
	foldable?: boolean;
	/** Leaves with `clampLines` clamp behind Show more; a gated panel draws every line. */
	clamp?: boolean;
}) {
	return (
		<ul role="list" aria-label={PERMISSION_ROWS_LABEL} className={LIST_GAPS_CLASS}>
			<RowItems rows={rows} foldable={foldable} clamp={clamp} />
		</ul>
	);
}

function RowItems({rows, foldable, clamp}: {rows: readonly PermissionRow[]; foldable: boolean; clamp: boolean}) {
	return (
		<>
			{rows.map((row, index) =>
				"rows" in row ? (
					<li key={`${index}\n${JSON.stringify(row)}`}>
						<RowGroup row={row} foldable={foldable} clamp={clamp} />
					</li>
				) : (
					<li key={index} className={LEAF_CLASS}>
						<RowLabel row={row} />
						<RowValue row={row} clamp={clamp} />
					</li>
				),
			)}
		</>
	);
}

function RowLabel({row, id, inheritColor = false}: {row: PermissionRow; id?: string; inheritColor?: boolean}) {
	const className = `min-w-0 text-footnote select-text break-words ${inheritColor ? "" : "text-muted-as-secondary "}${
		row.labelCode === true
			? "font-mono whitespace-pre-wrap [unicode-bidi:bidi-override]"
			: "[unicode-bidi:plaintext]"
	}`;
	return (
		<span id={id} dir={row.labelCode === true ? "ltr" : undefined} className={className}>
			{row.label}
		</span>
	);
}

function RowGroup({row, foldable, clamp}: {row: PermissionRowGroup; foldable: boolean; clamp: boolean}) {
	const id = useId();
	const [open, setOpen] = useState(true);
	const list = (
		<ul role="list" aria-labelledby={id} className={`${LIST_GAPS_CLASS} ms-2 border-s border-alpha-3 ps-2`}>
			<RowItems rows={row.rows} foldable={foldable} clamp={clamp} />
		</ul>
	);
	if (!foldable) {
		return (
			<div className={LIST_CLASS}>
				<RowLabel row={row} id={id} />
				{list}
			</div>
		);
	}
	const count = row.rows.length;
	return (
		<Collapsible.Root open={open} onOpenChange={setOpen} className={LIST_CLASS}>
			<Collapsible.Trigger className="touch:min-h-11 max-w-full gap-x-2 text-start text-footnote text-muted-as-secondary">
				<span className="sr-only">Group:</span> <RowLabel row={row} id={id} inheritColor />{" "}
				<span className={open ? "sr-only" : "shrink-0 whitespace-nowrap"}>{`(${count} ${
					count === 1 ? "field" : "fields"
				})`}</span>
			</Collapsible.Trigger>
			<Collapsible.Panel hiddenUntilFound>{list}</Collapsible.Panel>
		</Collapsible.Root>
	);
}

/** Upstream `_`: the value overflows its clamp, re-checked as it resizes. */
function watchOverflow(element: HTMLElement, onOverflow: (overflows: boolean) => void): (() => void) | undefined {
	const check = () => {
		onOverflow(element.scrollHeight > element.clientHeight + 1);
	};
	check();
	if (typeof ResizeObserver === "undefined") return undefined;
	const observer = new ResizeObserver(check);
	observer.observe(element);
	return () => {
		observer.disconnect();
	};
}

function RowValue({row, clamp}: {row: PermissionRowLeaf; clamp: boolean}) {
	const ref = useRef<HTMLSpanElement>(null);
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);
	const clamped = clamp && row.clampLines !== undefined;
	useEffect(() => {
		const element = ref.current;
		if (element === null || !clamped || expanded) return undefined;
		return watchOverflow(element, setOverflows);
	}, [row.value, clamped, expanded]);
	const code = row.code === true;
	const className = [
		"min-w-0 select-text whitespace-pre-wrap break-words text-body text-primary",
		...(code ? ["font-mono [unicode-bidi:bidi-override] text-code"] : []),
		...(clamped && !expanded ? ["line-clamp-6"] : []),
	].join(" ");
	const value = (
		<span ref={ref} data-approval-value="" dir={code ? "ltr" : undefined} className={className}>
			{code
				? row.value
				: row.value.split("\n").map((line, index) => (
						// oxlint-disable-next-line react/no-array-index-key -- lines are positional
						<Fragment key={index}>
							{index > 0 ? "\n" : null}
							<bdi>{line}</bdi>
						</Fragment>
					))}
		</span>
	);
	if (!clamped) return value;
	return (
		<span className="flex min-w-0 flex-col gap-0.5">
			{value}
			{(overflows || expanded) && (
				<button
					type="button"
					className="self-start cursor-pointer rounded-r4 text-footnote text-muted-as-secondary hover:text-secondary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
					aria-expanded={expanded}
					onClick={() => {
						setExpanded((was) => !was);
					}}
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
		</span>
	);
}
