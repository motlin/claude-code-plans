import {sheetUrl, useSheetDecoded} from "../lib/working-mark-sheets";
import {WORKING_MARK_FRAME_MS, WORKING_MARK_FRAMES, type WorkingMarkActivity} from "../lib/working-mark-activity";

const MARK_SIZE = 20;

/** Upstream's stand-in while a sheet loads: a 7px dot in the mark's clay ink. */
const LOADING_DOT_SIZE = 7;

/**
 * Upstream claude.ai/code's clay WorkingMark: a 20px window over the
 * activity's vertical loop sprite sheet (vendored into `public/working-mark/`
 * by `scripts/vendor-working-mark.mjs`), stepped one frame per 33.33ms.
 * Upstream plays the strip with WAAPI `steps(n, jump-none)`; a CSS animation
 * does the same. Unanimated (or under reduced motion) it holds frame 0.
 * Until the sheet has decoded it shows upstream's 7px clay dot instead.
 */
export function WorkingMark({
	activity,
	animated = true,
	className,
}: Readonly<{activity: WorkingMarkActivity; animated?: boolean; className?: string}>) {
	const frames = WORKING_MARK_FRAMES[activity];
	const decoded = useSheetDecoded(activity);
	return (
		<span
			aria-hidden
			data-cds="WorkingMark"
			data-activity={activity}
			data-animated={String(animated)}
			className={`relative block shrink-0 select-none${className === undefined ? "" : ` ${className}`}`}
			style={{width: MARK_SIZE, height: MARK_SIZE, color: "var(--color-clay)"}}
		>
			{!decoded && (
				<span
					className="absolute inset-0 m-auto block rounded-full bg-current"
					style={{width: LOADING_DOT_SIZE, height: LOADING_DOT_SIZE}}
				/>
			)}
			{decoded && (
				<span className="absolute inset-0 overflow-clip">
					<span
						data-working-mark-strip=""
						className="block"
						style={{
							width: MARK_SIZE,
							height: frames * MARK_SIZE,
							backgroundImage: `url(${sheetUrl(activity)})`,
							backgroundSize: "100% 100%",
							backgroundRepeat: "no-repeat",
							["--working-mark-end" as string]: `${-(frames - 1) * MARK_SIZE}px`,
							...(animated
								? {
										animation: `working-mark-strip ${Math.round(frames * WORKING_MARK_FRAME_MS)}ms steps(${frames}, jump-none) infinite`,
									}
								: {}),
						}}
					/>
				</span>
			)}
		</span>
	);
}
