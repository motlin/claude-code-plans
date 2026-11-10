import {type CSSProperties, type FocusEvent, type PointerEvent, useEffect, useRef, useState} from "react";
import {DISABLED_REASON_ATTR, DISABLED_REASON_WRAPPER_ATTR} from "../lib/file-refs";
import {useShrinkwrap} from "../hooks/use-shrinkwrap";
import {OPEN_DELAY_MS, REASON_TOOLTIP_CLASS, SIDE_CLASS} from "./ui/tooltip-classes";
import {ViewportPortal} from "./viewport-portal";

/** Whether a pointer event's other end (`relatedTarget`) lies outside `wrapper`, so the pointer crossed its edge. */
function crossesEdge(wrapper: HTMLElement, other: EventTarget | null): boolean {
	return !(other instanceof Node && wrapper.contains(other));
}

function reasonWrapperOf(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element ? target.closest<HTMLElement>(`[${DISABLED_REASON_WRAPPER_ATTR}]`) : null;
}

interface OpenReason {
	text: string;
	anchor: CSSProperties;
}

/**
 * The disabled-reason tooltip for blocked file refs: side top, opened after the
 * hover delay or at once on focus, showing the wrapper's hidden
 * `[data-cds-disabled-reason]`. Its handlers delegate, so they go on the wrapper
 * itself or on any ancestor (rendered HTML can't hold a {@link Tooltip} element).
 */
export function useReasonTooltip() {
	const [reason, setReason] = useState<OpenReason | null>(null);
	/* Upstream's DisabledReasonTooltip renders through the cds Tooltip popup, which hugs its balanced lines. */
	const fitTip = useShrinkwrap({immediate: true});
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(
		() => () => {
			clearTimeout(timer.current);
		},
		[],
	);

	function show(wrapper: HTMLElement, delay: number) {
		clearTimeout(timer.current);
		const reveal = () => {
			const {left, top, width, height} = wrapper.getBoundingClientRect();
			const text = wrapper.querySelector(`[${DISABLED_REASON_ATTR}]`)?.textContent ?? "";
			setReason({text, anchor: {left, top, width, height}});
		};
		if (delay === 0) reveal();
		else timer.current = setTimeout(reveal, delay);
	}

	function hide() {
		clearTimeout(timer.current);
		setReason(null);
	}

	const handlers = {
		onPointerOver: (event: PointerEvent<HTMLElement>) => {
			const wrapper = reasonWrapperOf(event.target);
			if (wrapper !== null && crossesEdge(wrapper, event.relatedTarget)) show(wrapper, OPEN_DELAY_MS);
		},
		onPointerOut: (event: PointerEvent<HTMLElement>) => {
			const wrapper = reasonWrapperOf(event.target);
			if (wrapper !== null && crossesEdge(wrapper, event.relatedTarget)) hide();
		},
		onFocus: (event: FocusEvent<HTMLElement>) => {
			const wrapper = reasonWrapperOf(event.target);
			if (wrapper !== null) show(wrapper, 0);
		},
		onBlur: (event: FocusEvent<HTMLElement>) => {
			if (reasonWrapperOf(event.target) !== null) hide();
		},
	};

	const tooltip =
		reason === null ? null : (
			<ViewportPortal>
				<span className="pointer-events-none fixed z-[140]" style={reason.anchor}>
					<span
						ref={fitTip}
						role="tooltip"
						data-side="top"
						className={`${REASON_TOOLTIP_CLASS} text-balance ${SIDE_CLASS.top}`}
					>
						{reason.text}
					</span>
				</span>
			</ViewportPortal>
		);
	return {handlers, tooltip};
}
