import {type CSSProperties, type ReactNode, type RefObject, useId, useLayoutEffect, useRef, useState} from "react";

import {Icon, type IconName} from "../ui/icon";

/* Upstream PanePlaceholder (cba0415d6 export `t`), class for class. */
const FRAME_CLASS =
	"grid h-full min-h-0 grid-cols-1 grid-rows-1 rounded-[inherit] has-[>:focus-visible]:after:pointer-events-none has-[>:focus-visible]:after:relative has-[>:focus-visible]:after:col-start-1 has-[>:focus-visible]:after:row-start-1 has-[>:focus-visible]:after:m-px has-[>:focus-visible]:after:rounded-[inherit] has-[>:focus-visible]:after:shadow-focus has-[>:focus-visible]:after:outline-hidden has-[>:focus-visible]:after:-outline-offset-2";
const SCROLLER_CLASS =
	"col-start-1 row-start-1 flex flex-col overflow-x-hidden overflow-y-auto scroll-py-2 px-lg text-center outline-none focus-visible:isolate before:min-h-2 before:flex-[1_1_var(--placeholder-pad)] after:min-h-2 after:flex-[1_1_var(--placeholder-pad)]";
const SCROLLER_STYLE =
{
	"--placeholder-pad": "var(--cds-pad-lg)",
} as CSSProperties;

/** Whether the element's content is taller than its box, kept live with a ResizeObserver. */
function useOverflows(ref: RefObject<HTMLElement | null>): boolean
{
	const [overflows, setOverflows] = useState(false);
	useLayoutEffect(() =>
	{
		const element = ref.current;
		if (element === null) return undefined;
		const measure = () =>
		{
			setOverflows(element.scrollHeight > element.clientHeight);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () =>
		{
			observer.disconnect();
		};
	}, [ref]);
	return overflows;
}

/**
 * Upstream's PanePlaceholder: an icon, title, optional body and actions centred in a pane, scrolling
 * when they don't fit. The scroller becomes a focusable labelled group only while it overflows or
 * holds focus, so keyboard users can scroll it.
 */
export function PanePlaceholder({
	icon,
	title,
	body,
	actions,
	role,
}: {
	icon: IconName;
	title: ReactNode;
	body?: ReactNode;
	actions?: ReactNode;
	role?: "alert" | "status";
})
{
	const ref = useRef<HTMLDivElement>(null);
	const titleId = useId();
	const [focused, setFocused] = useState(false);
	const scrollable = useOverflows(ref) || focused;
	return (
		<div className={FRAME_CLASS}>
			<div
				ref={ref}
				data-pane-placeholder=""
				tabIndex={scrollable ? 0 : undefined}
				role={scrollable ? "group" : undefined}
				aria-labelledby={scrollable ? titleId : undefined}
				onFocus={(event) =>
				{
					if (event.target === event.currentTarget) setFocused(true);
				}}
				onBlur={(event) =>
				{
					const target = event.currentTarget;
					if (event.target === target && target.ownerDocument.activeElement !== target) setFocused(false);
				}}
				className={SCROLLER_CLASS}
				style={SCROLLER_STYLE}
			>
				<div role={role} className="flex flex-col items-center gap-md">
					<Icon name={icon} size="lg" className="!size-7 text-muted-as-secondary" />
					<div className="flex flex-col items-center gap-1">
						<p
							id={scrollable ? titleId : undefined}
							className="max-w-[36ch] text-pretty break-words text-body text-primary"
						>
							{title}
						</p>
						{body !== undefined && (
							<p className="max-w-[36ch] text-pretty break-words text-footnote text-muted-as-secondary">
								{body}
							</p>
						)}
					</div>
					{actions !== undefined && (
						<div className="flex flex-wrap items-center justify-center gap-1">{actions}</div>
					)}
				</div>
			</div>
		</div>
	);
}
