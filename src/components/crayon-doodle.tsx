import {useId} from "react";
import {type CrayonKind, crayonArt} from "../lib/crayon-art";

/** Upstream's radial mask: the doodle shows at 47% in the middle and fully at the edges. */
const DOODLE_MASK =
{
	maskImage:
		"radial-gradient(ellipse 44% 50% at 50% 50%, color-mix(in srgb, black 47%, transparent) 36%, black 100%)",
} as const;

/**
 * Upstream's crayon doodle layer (`Y`): the kind's strokes in the current colour, warped and grained by noise, at
 * 12% (6% when faint, as on a Docs cover).
 */
export function CrayonDoodle({kind, faint = false}: {kind: CrayonKind; faint?: boolean})
{
	const id = useId();
	const {transform, noiseSeed, warp, strokes} = crayonArt(kind);
	return (
		<span
			aria-hidden="true"
			className={`pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] ${faint ? "opacity-[0.06]" : "opacity-[0.12]"}`}
			style={DOODLE_MASK}
		>
			<svg viewBox="0 0 115 80" preserveAspectRatio="xMidYMid slice" className="block h-full w-full">
				<defs>
					<filter id={id} x="-5%" y="-5%" width="110%" height="110%">
						<feTurbulence
							type="fractalNoise"
							baseFrequency="0.9"
							numOctaves="2"
							seed={noiseSeed}
							result="noise"
						/>
						<feDisplacementMap in="SourceGraphic" in2="noise" scale={warp} result="warped" />
						<feColorMatrix
							in="noise"
							type="matrix"
							values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 1.75"
							result="grain"
						/>
						<feComposite in="warped" in2="grain" operator="in" />
					</filter>
				</defs>
				<g
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					filter={`url(#${id})`}
					transform={transform}
				>
					{strokes.map((stroke) => (
						<path
							key={`${stroke.d}${stroke.transform ?? ""}`}
							d={stroke.d}
							transform={stroke.transform}
							strokeWidth={stroke.width}
						/>
					))}
				</g>
			</svg>
		</span>
	);
}
