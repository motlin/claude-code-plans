import {type KeyboardEvent, type ReactNode, useCallback, useLayoutEffect, useRef} from "react";

import {applyThumb, groupScale, measureThumbRect} from "../../lib/segmented-flip";

import {Tooltip} from "../ui/tooltip";
import {useSettingsRowIds} from "./settings-row-context";

/*
 * The claude.ai/code SegmentedControl: a 32px radiogroup on a 5%-alpha track
 * with 1px padding and radius 8, 30px radios at px 12 with radius 6, and a
 * sliding thumb (surface fill, inset border ring, 1px shadow) under the
 * checked radio. The thumb is placed and FLIP-animated imperatively, like
 * upstream: it snaps on first measure, slides 200ms on --cds-ease-snap on a
 * change, and re-measures (snapping) when the group resizes or settles out of
 * the dialog's open zoom. Arrow keys move both the checked radio and focus (roving
 * tabindex); Home/End jump to the ends. Icon-only radios are 30x30 and named
 * by the shared Tooltip rather than a native title.
 */

interface SegmentedOption<T extends string> {
	value: T;
	label: string;
	icon?: ReactNode;
}

interface SegmentedControlProps<T extends string> {
	value: T;
	onValueChange: (value: T) => void;
	options: ReadonlyArray<SegmentedOption<T>>;
	/** Render icons only; each radio is then named by its aria-label. */
	iconOnly?: boolean;
	"aria-label"?: string;
	"aria-describedby"?: string;
}

/** Upstream `ns`/`gb`/`n1`: frames the group width must hold still (scaled/unscaled), and the poll cap. */
const SETTLE_FRAMES_SCALED = 30;
const SETTLE_FRAMES_UNSCALED = 2;
const SETTLE_FRAMES_MAX = 600;

interface SettlePoll {
	cancel: () => void;
	width: number;
	still: number;
	frames: number;
}

export function SegmentedControl<T extends string>({
	value,
	onValueChange,
	options,
	iconOnly = false,
	"aria-label": ariaLabel,
	"aria-describedby": ariaDescribedBy,
}: SegmentedControlProps<T>) {
	const row = useSettingsRowIds();
	const groupRef = useRef<HTMLDivElement>(null);
	const radioRefs = useRef<Array<HTMLSpanElement | null>>([]);
	const thumbRef = useRef<HTMLDivElement>(null);
	const pollRef = useRef<SettlePoll | null>(null);
	const liveRef = useRef(false);
	const checkedIndex = options.findIndex((option) => option.value === value);
	const optionsKey = options.map((option) => option.value).join("\0");

	// Upstream BI's `w`: measure and apply, then while the group is scaled (the dialog's open zoom) poll by
	// rAF until its width holds still, since a ResizeObserver never sees transforms. Corrections under a
	// scale wait for it to settle rather than placing the thumb mid-zoom.
	const syncThumb = useCallback(function sync(correction: boolean) {
		const group = groupRef.current;
		const thumb = thumbRef.current;
		if (group === null || thumb === null) return;
		const checked = group.querySelector<HTMLElement>("[role=radio][data-checked]");
		const scale = checked === null ? null : groupScale(group);
		if (!correction || scale?.scaled !== true) {
			applyThumb(thumb, group, checked === null ? null : measureThumbRect(checked, group), {correction})();
		}
		if (!liveRef.current) return;
		const poll = pollRef.current;
		poll?.cancel();
		pollRef.current = null;
		if (scale === null || (!correction && poll === null && !scale.scaled)) return;
		let {width, still, frames} = poll ?? {width: scale.width, still: 0, frames: 0};
		if (correction) {
			still = width === scale.width ? still + 1 : 0;
			width = scale.width;
			frames += 1;
			if (
				still >= (scale.scaled ? SETTLE_FRAMES_SCALED : SETTLE_FRAMES_UNSCALED) ||
				frames >= SETTLE_FRAMES_MAX
			) {
				return;
			}
		}
		const frame = requestAnimationFrame(() => {
			sync(true);
		});
		pollRef.current = {
			cancel: () => {
				cancelAnimationFrame(frame);
			},
			width,
			still,
			frames,
		};
	}, []);

	useLayoutEffect(() => {
		liveRef.current = true;
		const group = groupRef.current;
		const observer =
			group === null || typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(() => {
						syncThumb(true);
					});
		if (group !== null) observer?.observe(group);
		return () => {
			observer?.disconnect();
			liveRef.current = false;
			pollRef.current?.cancel();
			pollRef.current = null;
		};
	}, [syncThumb]);

	useLayoutEffect(() => {
		syncThumb(false);
	}, [syncThumb, value, optionsKey]);

	const select = (index: number) => {
		const option = options[index];
		if (option === undefined) return;
		onValueChange(option.value);
		radioRefs.current[index]?.focus();
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>, index: number) => {
		const last = options.length - 1;
		let next: number | null = null;
		switch (event.key) {
			case "ArrowRight":
			case "ArrowDown":
				next = index === last ? 0 : index + 1;
				break;
			case "ArrowLeft":
			case "ArrowUp":
				next = index === 0 ? last : index - 1;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = last;
				break;
			case " ":
			case "Enter":
				next = index;
				break;
			default:
				return;
		}
		event.preventDefault();
		select(next);
	};

	return (
		<div
			ref={groupRef}
			role="radiogroup"
			data-cds="SegmentedControl"
			aria-label={ariaLabel}
			aria-labelledby={ariaLabel === undefined ? row?.titleId : undefined}
			aria-describedby={ariaDescribedBy ?? row?.descriptionId}
			className="relative inline-flex h-8 w-fit shrink-0 items-stretch rounded-r6 bg-[var(--settings-segmented-track)] p-px font-sans"
		>
			<div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-clip rounded-r6">
				<div
					ref={thumbRef}
					className="invisible absolute top-px bottom-px left-0 origin-left rounded-[calc(var(--radius-r6)-1px)] bg-[var(--settings-segmented-thumb)] shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_0_rgb(0_0_0/0.05)] forced-colors:border-2 forced-colors:border-solid forced-colors:border-[color:Highlight]"
				/>
			</div>
			{options.map((option, index) => {
				const checked = index === checkedIndex;
				const focusable = checked || (checkedIndex === -1 && index === 0);
				const radio = (
					<span
						key={option.value}
						ref={(element) => {
							radioRefs.current[index] = element;
						}}
						role="radio"
						tabIndex={focusable ? 0 : -1}
						aria-checked={checked}
						aria-label={iconOnly ? option.label : undefined}
						data-checked={checked ? "" : undefined}
						onClick={() => {
							select(index);
						}}
						onKeyDown={(event) => {
							handleKeyDown(event, index);
						}}
						className={`relative z-[1] inline-flex h-full cursor-pointer items-center justify-center gap-1.5 rounded-r5 text-body font-control-regular outline-none select-none transition-shadow duration-[60ms] hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus data-[checked]:text-primary text-[var(--settings-segmented-ink)] ${
							iconOnly ? "w-[30px] [&_svg]:size-4" : "px-3"
						}`}
					>
						{option.icon === undefined ? null : option.icon}
						{iconOnly ? null : option.label}
					</span>
				);
				return iconOnly ? (
					<Tooltip key={option.value} content={option.label} className="z-[1]">
						{radio}
					</Tooltip>
				) : (
					radio
				);
			})}
		</div>
	);
}
