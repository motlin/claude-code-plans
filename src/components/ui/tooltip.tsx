import {cloneElement, type ReactElement, useEffect, useId, useRef, useState} from "react";

import {Shortcut} from "./shortcut";

const OPEN_DELAY_MS = 300;

const SIDE_CLASS = {
	top: "bottom-full left-1/2 mb-1 -translate-x-1/2",
	bottom: "top-full left-1/2 mt-1 -translate-x-1/2",
	right: "left-full top-1/2 ml-1 -translate-y-1/2",
} as const;

const TOOLTIP_CLASS =
	"pointer-events-none absolute z-50 inline-flex min-h-6 max-w-[240px] items-center gap-2 whitespace-nowrap rounded-r5 bg-[var(--tooltip-bg)] px-2 py-[3px] text-[13px]/[18px] text-[var(--tooltip-fg)] shadow-sm";

/**
 * Minimal claude.ai/code tooltip: always dark, side top (titlebar controls use
 * bottom, sidebar family handles right), offset 4, 300ms open delay, with an optional text-variant shortcut
 * after the label.
 */
export function Tooltip({
	content,
	shortcut,
	secondary,
	side = "top",
	className,
	children,
}: {
	content: string;
	shortcut?: string;
	/** A second action on the same control, shown after a "·", e.g. Send ⏎ · Fork with this prompt ⌥⌘⏎. */
	secondary?: {content: string; shortcut: string} | undefined;
	side?: keyof typeof SIDE_CLASS;
	className?: string;
	children: ReactElement<{"aria-describedby"?: string}>;
}) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => () => clearTimeout(timer.current), []);

	function show() {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
	}

	function hide() {
		clearTimeout(timer.current);
		setOpen(false);
	}

	return (
		<span
			className={className ? `relative inline-flex ${className}` : "relative inline-flex"}
			onPointerEnter={show}
			onPointerLeave={hide}
			onFocus={show}
			onBlur={hide}
			onClick={hide}
		>
			{open
				? cloneElement(children, {
						"aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
					})
				: children}
			{open && (
				<span role="tooltip" id={id} className={`${TOOLTIP_CLASS} ${SIDE_CLASS[side]}`}>
					{content}
					{shortcut !== undefined && <TooltipShortcut keys={shortcut} />}
					{secondary !== undefined && (
						<>
							<span aria-hidden="true">·</span>
							{secondary.content}
							<TooltipShortcut keys={secondary.shortcut} />
						</>
					)}
				</span>
			)}
		</span>
	);
}

function TooltipShortcut({keys}: {keys: string}) {
	return (
		<Shortcut keys={keys} variant="text" className="text-[12px] [--shortcut-cap-ink:var(--tooltip-shortcut-ink)]" />
	);
}
