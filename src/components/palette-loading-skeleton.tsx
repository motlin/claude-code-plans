import {Skeleton} from "./ui/skeleton";
import type {PaletteLoadingVariant} from "../lib/palette-loading";

function bar(width: number, height: number)
{
	return (
		<Skeleton
			className="h-[1em] rounded"
			style={
			{
				width: `${width}px`,
				height: `${height}px`,
			}}
		/>
	);
}

const TAB_WIDTHS = [20, 40, 56, 58];
const ROW_WIDTHS = [224, 176, 256, 200, 160, 240, 192];
/** Upstream's empty-view skeleton groups: title width, row count, row-width offset. */
const GROUPS: Array<[number, number, number]> = [
	[88, 1, 0],
	[56, 5, 1],
	[56, 2, 6],
];

function Group({title, rows, offset}: {title: number; rows: number; offset: number})
{
	return (
		<div>
			<div className="box-border flex h-[37px] w-full shrink-0 items-center px-3.5 pt-3 pb-2">
				{bar(title, 10)}
			</div>
			{Array.from(
				{
					length: rows,
				},
				(_, row) => (
					<div key={row} className="flex shrink-0 items-center gap-2 px-3 py-2 box-content h-5">
						{bar(20, 20)}
						{bar(ROW_WIDTHS[(row + offset) % ROW_WIDTHS.length] ?? 0, 14)}
					</div>
				),
			)}
		</div>
	);
}

/**
 * Upstream `v8` (shared-19), the `command_palette` lazy entry's `loading` fallback: a view-shaped skeleton inside
 * the palette card while the palette module downloads. Compose is the 118px inset-field box and a 2-bar footer;
 * Search is the header, type-tabs strip, hairline, 440px empty-view body and a 3-bar footer (about the settled card).
 */
export function PaletteLoadingSkeleton({variant}: {variant: PaletteLoadingVariant})
{
	return (
		<div
			data-palette-loading=""
			className="flex flex-col max-h-[calc(min(100vh,var(--cp-visible-h,100vh))-var(--cp-top)-2rem)]"
		>
			{variant === "compose" ? (
				<>
					<div className="flex-shrink-0 pb-1">
						<div className="relative box-border flex h-[7.375rem] items-start ps-[1.5rem] pt-[1.1rem] pe-2.5">
							<div
								aria-hidden="true"
								className="pointer-events-none absolute inset-1.5 rounded-composer bg-fill-field shadow-panel-sm-cds"
							/>
							<span className="relative flex h-8 items-center">{bar(144, 14)}</span>
						</div>
					</div>
					<div
						aria-hidden="true"
						className="box-content flex h-5 flex-shrink-0 items-center gap-5 bg-surface-3 pb-2.5 ps-5 pe-4"
					>
						{bar(56, 10)}
						{bar(120, 10)}
					</div>
				</>
			) : (
				<>
					<div className="flex-shrink-0">
						<div className="box-content flex h-8 items-center gap-2 ps-[1.5rem] pt-[1.1rem] pb-[0.9rem] pe-2.5">
							{bar(176, 14)}
						</div>
						<div
							aria-hidden="true"
							className="flex items-start gap-5 !ps-[2.125rem] relative -mt-1.5 px-[1.5rem]"
							style={
							{
								height: 42.4,
							}}
						>
							{TAB_WIDTHS.map((width) => (
								<span key={width} className="flex h-7 items-center">
									{bar(width, 12)}
								</span>
							))}
						</div>
						<div className="border-t-[length:var(--cds-toolbar-line,0px)] h-[calc(0.5px_-_min(var(--cds-toolbar-line,0px),0.5px))] w-full bg-border bg-clip-padding" />
					</div>
					<div
						aria-hidden="true"
						className="min-h-0 overflow-hidden p-2.5"
						style={
						{
							height: 440,
						}}
					>
						<div className="flex flex-col gap-1">
							{GROUPS.map(([title, rows, offset]) => (
								<Group key={offset} title={title} rows={rows} offset={offset} />
							))}
						</div>
					</div>
					<div
						aria-hidden="true"
						className="box-content flex h-5 flex-shrink-0 items-center gap-5 bg-surface-3 py-2.5 ps-5 pe-4 border-t-[length:max(var(--cds-toolbar-line,0px),0.5px)] border-border pointer-coarse:hidden"
					>
						{bar(64, 10)}
						{bar(72, 10)}
						{bar(88, 10)}
					</div>
				</>
			)}
		</div>
	);
}
