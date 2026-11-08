import {
	createContext,
	type CSSProperties,
	type FocusEvent,
	Fragment,
	type HTMLAttributes,
	lazy,
	type PointerEvent,
	type ReactNode,
	type RefObject,
	Suspense,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import {
	assignMeterColors,
	type ChartColor,
	chartInk,
	chartPaint,
	formatMeterAmount,
	formatPrintedAmount,
	layoutStackedMeter,
	layoutStackedMeterBlocks,
	meterPercent,
	meterRows,
	type MeterRowCategory,
} from "../../lib/stacked-meter-layout";
import {Tooltip, TooltipGroup} from "./tooltip";
import {useInTooltipGroup} from "./tooltip-group-context";
import type {StackedMeterReadoutRow} from "./stacked-meter-readout";

/* Upstream's cds StackedMeterGroup / StackedMeter (c91b6e9db): a group declares the categories, each meter draws values. */

export interface StackedMeterCategory extends MeterRowCategory {
	label: string;
	color?: ChartColor | undefined;
	hidden?: boolean | undefined;
	ghost?: boolean | undefined;
}

export type StackedMeterSize = "xs" | "sm" | "md" | "lg";

interface MeterSeries {
	id: string;
	label: string;
	paint: string;
	ink: string;
	hidden: boolean;
	value?: MeterRowCategory["value"];
}

interface StackedMeterConfig {
	series: MeterSeries[];
	visible: MeterSeries[];
	formatAmount: (n: number) => string;
	formatShare: (n: number) => string;
	printed: ((amount: number, share: number) => string) | null;
	size: StackedMeterSize | undefined;
	thickness: number;
}

const StackedMeterContext = createContext<StackedMeterConfig | null>(null);

const SHARE = new Intl.NumberFormat("en-US", {style: "percent", maximumSignificantDigits: 2});
const formatShare = (share: number) => SHARE.format(share);

/** Upstream's `pe`: paints, formatters and thickness for a group's meters. */
function configure(
	categories: readonly StackedMeterCategory[],
	size: StackedMeterSize | undefined,
	valueLabels: "amount" | "share" | undefined,
	formatValue: ((n: number) => string) | undefined,
): StackedMeterConfig {
	const colors = assignMeterColors(categories);
	const series = categories.map((category, i) => {
		const color = colors[i] ?? "muted";
		return {
			id: category.id,
			label: category.label,
			paint: chartPaint(color),
			ink: chartInk(color),
			hidden: category.hidden ?? false,
			...(category.value === undefined ? {} : {value: category.value}),
		};
	});
	const labels = size === "lg" ? valueLabels : undefined;
	const printAmount = labels === "amount" ? (formatValue ?? formatPrintedAmount) : null;
	return {
		series,
		visible: series.filter((s) => !s.hidden),
		formatAmount: formatValue ?? formatMeterAmount,
		formatShare,
		printed:
			labels === undefined
				? null
				: (amount, share) => (printAmount === null ? formatShare(share) : printAmount(amount)),
		size,
		thickness: size === "lg" ? 28 : size === "sm" || size === "xs" ? 4 : 8,
	};
}

export function StackedMeterGroup({
	categories,
	size,
	valueLabels,
	formatValue,
	children,
}: {
	categories: readonly StackedMeterCategory[];
	size?: StackedMeterSize | undefined;
	/** lg only: print each block's amount or share on it. */
	valueLabels?: "amount" | "share" | undefined;
	formatValue?: ((n: number) => string) | undefined;
	children: ReactNode;
}) {
	const config = useMemo(
		() => configure(categories, size, valueLabels, formatValue),
		[categories, size, valueLabels, formatValue],
	);
	return <StackedMeterContext.Provider value={config}>{children}</StackedMeterContext.Provider>;
}

/** A legend swatch in a series' paint (upstream's `ChartLegend.Swatch`); nothing for hidden or unknown series. */
export function StackedMeterSwatch({series, ...props}: {series: string} & HTMLAttributes<HTMLSpanElement>) {
	const config = useContext(StackedMeterContext);
	const found = config?.visible.find((s) => s.id === series);
	if (found === undefined) return null;
	return (
		<span
			{...props}
			aria-hidden
			className="shrink-0 forced-color-adjust-none"
			style={{
				width: 10,
				height: 10,
				borderRadius: 2,
				background: found.paint,
				display: "inline-block",
			}}
		/>
	);
}

/** Upstream's `R`: the meter's width, 640 until it has been measured. */
const INITIAL_WIDTH = 640;

function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number {
	const [width, setWidth] = useState(INITIAL_WIDTH);
	useLayoutEffect(() => {
		const element = ref.current;
		if (element === null) return undefined;
		const measure = () => {
			const measured = element.getBoundingClientRect().width;
			if (measured > 0) setWidth(measured);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => {
			observer.disconnect();
		};
	}, [ref]);
	return width;
}

/** Whether the meter sits in a right-to-left subtree (upstream's direction hook). */
function useRtl(ref: RefObject<HTMLElement | null>): boolean {
	const [rtl, setRtl] = useState(false);
	useLayoutEffect(() => {
		setRtl(ref.current?.closest("[dir]")?.getAttribute("dir") === "rtl");
	}, [ref]);
	return rtl;
}

/** Strong right-to-left characters (Hebrew, Arabic and their presentation forms), upstream's `HW`. */
const STRONG_RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;

type Pointed = {x: number | null; category: string | null; touch: boolean};

/** The pointed block of an lg meter, and the handlers that track it (upstream's `le`). */
function useReadoutPointer() {
	const [state, setState] = useState<Pointed | "dismissed" | null>(null);
	const touch = state !== null && state !== "dismissed" && state.touch;
	const point = (event: PointerEvent<HTMLDivElement>): Pointed => {
		const root = event.currentTarget;
		const rect = root.getBoundingClientRect();
		const scale = root.offsetWidth > 0 ? rect.width / root.offsetWidth : 1;
		const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-category]"), (block) => {
			const {left, right} = block.getBoundingClientRect();
			return {category: block.dataset["category"] ?? "", left, right};
		});
		const hit = blocks.find((block) => event.clientX >= block.left && event.clientX < block.right);
		return {
			x: ((hit ? (hit.left + hit.right) / 2 : event.clientX) - rect.left) / scale,
			category: hit?.category ?? null,
			touch: touch || event.pointerType === "touch",
		};
	};
	const close = () => {
		setState(null);
	};
	return {
		pointed: state === "dismissed" ? null : state,
		dismiss: () => {
			setState("dismissed");
		},
		close,
		handlers: {
			onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
				setState(point(event));
			},
			onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
				if (state === "dismissed") return;
				const next = point(event);
				setState((prev) =>
					prev === "dismissed" || (prev?.x === next.x && prev.category === next.category) ? prev : next,
				);
			},
			onPointerLeave: close,
			onPointerCancel: close,
			onFocus: (event: FocusEvent<HTMLDivElement>) => {
				if (event.currentTarget.matches(":focus-visible")) setState({x: null, category: null, touch});
			},
			onBlur: close,
		},
	};
}

const loadReadout = async () => import("./stacked-meter-readout");
const ReadoutCard = lazy(async () => ({default: (await loadReadout()).StackedMeterReadoutCard}));

/** Upstream idle-preloads the readout chunk once an lg meter has rows (timeout 2000, fallback delay 200). */
function usePreloadReadout(enabled: boolean) {
	useEffect(() => {
		if (!enabled) return undefined;
		const warm = () => {
			loadReadout().catch(() => {});
		};
		if (typeof window.requestIdleCallback === "function") {
			const handle = window.requestIdleCallback(warm, {timeout: 2000});
			return () => {
				window.cancelIdleCallback(handle);
			};
		}
		const handle = setTimeout(warm, 200);
		return () => {
			clearTimeout(handle);
		};
	}, [enabled]);
}

interface FormattedRow extends StackedMeterReadoutRow {
	line: string;
}

export function StackedMeter({
	values,
	total,
	readout = false,
	label,
	className,
	style,
}: {
	values: Readonly<Record<string, number>>;
	/** The meter's full scale; the unfilled rest is tinted. Omitted, the values fill the meter. */
	total?: number | undefined;
	/** Read the rows aloud and show them in tooltips (sm/md) or the readout card (lg). */
	readout?: boolean;
	label?: string | undefined;
	className?: string | undefined;
	style?: CSSProperties | undefined;
}) {
	const config = useContext(StackedMeterContext);
	if (config === null) {
		throw new Error("<StackedMeter> must be rendered inside a <StackedMeterGroup>, which declares its categories.");
	}
	const {visible, thickness, printed} = config;
	const lg = config.size === "lg";
	const root = useRef<HTMLDivElement>(null);
	const width = useMeasuredWidth(root);
	const rtl = useRtl(root);
	const inGroup = useInTooltipGroup();
	const {pointed, handlers, dismiss, close} = useReadoutPointer();
	const rows = meterRows(visible, values, total);
	const layout = layoutStackedMeter(
		rows.map((row) => row.share),
		width,
		thickness,
	);
	const formatted: FormattedRow[] =
		readout || printed !== null
			? rows.flatMap((row, i) => {
					const series = visible[i];
					if (series === undefined) return [];
					const amount = config.formatAmount(row.amount);
					const share = config.formatShare(row.share);
					return [
						{
							id: series.id,
							label: series.label,
							paint: series.paint,
							amount,
							share,
							line: `${series.label}: ${amount}, ${share}`,
						},
					];
				})
			: [];
	const hasRows = formatted.length > 0;
	const lgReadout = hasRows && lg;
	usePreloadReadout(lgReadout);
	const linesKey = formatted.map((row) => row.line).join("\n");
	const tips = useMemo(
		() =>
			formatted.map((row): ReactNode =>
				rtl || STRONG_RTL.test(row.line) ? (
					<>
						<bdi>{row.label}</bdi>: <bdi>{row.amount}</bdi>, <bdi>{row.share}</bdi>
					</>
				) : (
					row.line
				),
			),
		// The lines key covers every formatted row; rebuilding on it keeps the nodes stable across renders.
		// oxlint-disable-next-line react-hooks/exhaustive-deps
		[linesKey, rtl],
	);
	const wholeTip = useMemo(
		() =>
			tips.every((tip) => typeof tip === "string")
				? tips.join("\n")
				: tips.map((tip, i) => (
						// oxlint-disable-next-line react/no-array-index-key -- lines are positional
						<Fragment key={i}>
							{i > 0 && "\n"}
							{tip}
						</Fragment>
					)),
		[tips],
	);
	const paint = (index: number) => visible[index]?.paint;
	const segmentChildren = () => {
		if (lg) return null;
		if (layout.kind === "dot") {
			const dotStyle = {width: thickness, backgroundColor: paint(layout.index)};
			const dotClass = "absolute inset-y-0 start-0 rounded-full forced-color-adjust-none";
			if (!hasRows) return <div className={dotClass} style={dotStyle} />;
			return (
				<Tooltip portal content={tips[layout.index] ?? ""} maxWidth="max-w-none" className="absolute! inset-0">
					<div className={dotClass} style={dotStyle} />
				</Tooltip>
			);
		}
		if (layout.kind !== "segments") return null;
		return layout.segments.map((segment) => {
			const series = visible[segment.index];
			if (series === undefined) return null;
			const position = {
				insetInlineStart: `calc(${meterPercent(segment.start)}% + ${segment.seam}px)`,
				width: `calc(${meterPercent(segment.width)}% - ${segment.seam}px)`,
			};
			const fill = {
				backgroundColor: series.paint,
				borderStartStartRadius: segment.radiusStart,
				borderEndStartRadius: segment.radiusStart,
				borderStartEndRadius: segment.radiusEnd,
				borderEndEndRadius: segment.radiusEnd,
			};
			if (!hasRows) {
				return (
					<div
						key={series.id}
						className="absolute inset-y-0 forced-color-adjust-none"
						style={{...position, ...fill}}
					/>
				);
			}
			return (
				<Tooltip
					key={series.id}
					portal
					content={tips[segment.index] ?? ""}
					maxWidth="max-w-none"
					className="absolute! inset-y-0"
					style={position}
				>
					<div className="absolute inset-0 forced-color-adjust-none" style={fill} />
				</Tooltip>
			);
		});
	};
	const dataSize = config.size !== undefined && !lg ? {"data-size": config.size} : {};
	const parts = formatted.map((row) => row.line).join("; ");
	const a11y = hasRows
		? {role: "img", "aria-label": label ? `${label}: ${parts}` : parts, tabIndex: 0}
		: {"aria-hidden": true};
	const meter = (
		<div
			ref={root}
			data-cds="StackedMeter"
			{...dataSize}
			{...a11y}
			{...(lgReadout ? handlers : {})}
			className={[
				"relative w-full overflow-hidden",
				(total !== undefined || layout.kind !== "empty") &&
					"forced-colors:outline forced-colors:outline-solid forced-colors:outline-[color:CanvasText]",
				lg ? "flex" : "rounded-full",
				lgReadout && "touch-pan-y touch-pinch-zoom",
				hasRows && "outline-none focus-visible:outline-hidden focus-visible:shadow-focus",
				className,
			]
				.filter(Boolean)
				.join(" ")}
			style={{
				backgroundColor: total === undefined || lg ? undefined : "var(--chart-reference-tint)",
				borderRadius: lg ? 4 : undefined,
				gap: lg ? 2 : undefined,
				...style,
				containerType: "inline-size",
				height: thickness,
			}}
		>
			{segmentChildren()}
			{lg && (
				<MeterBlocks
					rows={rows}
					series={visible}
					width={width}
					thickness={thickness}
					hasTotal={total !== undefined}
					printed={printed}
					rtl={rtl}
				/>
			)}
			{lgReadout && pointed !== null && (
				<Suspense fallback={null}>
					<ReadoutCard
						key={pointed.touch ? "finger" : "other"}
						barRef={root}
						width={width}
						thickness={thickness}
						x={pointed.x ?? width / 2}
						heading={label}
						rows={formatted}
						pointedId={pointed.category}
						above={pointed.touch}
						onDismiss={dismiss}
						onDisplaced={close}
					/>
				</Suspense>
			)}
		</div>
	);
	if (!hasRows || lgReadout) return meter;
	const tipped = (
		<Tooltip multiline maxWidth="max-w-none" content={wholeTip} className="block w-full">
			{meter}
		</Tooltip>
	);
	return inGroup ? tipped : <TooltipGroup closeDelay={200}>{tipped}</TooltipGroup>;
}

/** Upstream's lg body `ge`: a run of 2px-apart blocks, each optionally printing its value, then the rest track. */
function MeterBlocks({
	rows,
	series,
	width,
	thickness,
	hasTotal,
	printed,
	rtl,
}: {
	rows: readonly {amount: number; share: number}[];
	series: readonly MeterSeries[];
	width: number;
	thickness: number;
	hasTotal: boolean;
	printed: ((amount: number, share: number) => string) | null;
	rtl: boolean;
}) {
	const {run, blocks, rest} = layoutStackedMeterBlocks(
		rows.map((row) => row.share),
		width,
	);
	return (
		<>
			{blocks.length > 0 && (
				<div className="flex shrink-0" style={{width: `${meterPercent(run)}%`, minWidth: 4, gap: 2}}>
					{blocks.map(({index, grow}) => {
						const row = rows[index];
						const category = series[index];
						if (row === undefined || category === undefined) return null;
						const text = printed?.(row.amount, row.share);
						return (
							<div
								key={index}
								data-category={category.id}
								className="flex min-w-0 flex-wrap items-center overflow-clip forced-color-adjust-none"
								style={{flex: `${grow} 1 0`, backgroundColor: category.paint, borderRadius: 4}}
							>
								{text !== undefined && (
									<>
										<span style={{height: thickness}} />
										<span
											className={`text-caption font-semibold tabular-nums px-sm whitespace-nowrap select-none ${category.ink}`}
										>
											{rtl ? <bdi>{text}</bdi> : text}
										</span>
									</>
								)}
							</div>
						);
					})}
				</div>
			)}
			{hasTotal && rest && (
				<div className="flex-1" style={{backgroundColor: "var(--chart-reference-tint)", borderRadius: 4}} />
			)}
		</>
	);
}
