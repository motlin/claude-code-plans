import {Files, Folder, Image} from "lucide-react";
import type {CSSProperties} from "react";

const RISE_CLASS =
	"motion-safe:animate-[cds-drop-icon-rise_0.22s_cubic-bezier(0.215,0.61,0.355,1)_var(--rise-delay,0ms)_backwards]";

function riseDelay(ms: number): CSSProperties
{
	return {
		"--rise-delay": `${ms}ms`,
	};
}

/** Upstream's three rising drop icons (`Dc`), fanned out around the middle one. */
export function DropIcons()
{
	return (
		<>
			<span className="-rotate-[14deg]">
				<Image size={24} className={RISE_CLASS} style={riseDelay(60)} />
			</span>
			<span className="-translate-y-3">
				<Files size={24} className={RISE_CLASS} />
			</span>
			<span className="rotate-[14deg]">
				<Folder size={24} className={RISE_CLASS} style={riseDelay(120)} />
			</span>
		</>
	);
}

const FADE_IN_CLASS = "motion-safe:animate-[cds-fade-in_0.15s_cubic-bezier(0.215,0.61,0.355,1)]";

/**
 * Upstream's full-page drop overlay (`cf6507c5a` `Oc`, `area` false), drawn inside a drop zone while files are dragged:
 * blur, a 60% page wash and the accent-ringed "Drop files here" frame, every layer following the zone's radius.
 */
export function DropOverlay()
{
	return (
		<div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit]">
			<div className={`absolute inset-0 rounded-[inherit] backdrop-blur-[12px] ${FADE_IN_CLASS}`} />
			<div className={`absolute inset-0 rounded-[inherit] bg-page opacity-60 ${FADE_IN_CLASS}`} />
			<div className="absolute flex flex-col items-center justify-center gap-2 inset-3.5 rounded-card shadow-[inset_0_0_0_2px_var(--color-fill-accent)] motion-safe:animate-[cds-drop-ring-in_0.15s_cubic-bezier(0.215,0.61,0.355,1)]">
				<div className="absolute inset-0 rounded-[inherit] shadow-[inset_0_0_24px_0_color-mix(in_srgb,var(--color-fill-accent)_20%,transparent)] motion-safe:animate-[cds-fade-in_0.2s_cubic-bezier(0.215,0.61,0.355,1)_0.08s_backwards]" />
				<div
					className="flex items-end gap-3"
					style={
					{
						color: "var(--color-fill-accent)",
					}}
				>
					<DropIcons />
				</div>
				<span className="text-body font-medium text-accent-100">Drop files here</span>
			</div>
		</div>
	);
}

/** Upstream shared-frame `hZ=9e3`: the scrim escapes the cds overlay bands (all below 100) to paint above every overlay. */
export const DROP_SCRIM_Z_INDEX = 9000;
