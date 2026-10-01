import {useState} from "react";

/** One 250-unit pixel per cell on an 11x7 grid, nudged down to fill upstream's 2750x1850 viewBox. */
const BODY =
	"M250 350h2250v1000H250zM0 850h250v250H0zM2500 850h250v250h-250zM500 1350h250v500H500zM1000 1350h250v500h-250zM1500 1350h250v500h-250zM2000 1350h250v500h-250z";
const EYES = "M750 600h250v250H750zM1750 600h250v250h-250z";

/**
 * Upstream's Clawd easter egg: a pixel-art crab peeking over the home composer's top-right corner.
 * Only its painted pixels take clicks, and a click plays a short hop (skipped under reduced motion).
 */
export function ClawdMascot() {
	const [hopping, setHopping] = useState(false);

	return (
		<div className="pointer-events-none relative h-0">
			<button
				type="button"
				tabIndex={-1}
				aria-hidden="true"
				data-clawd-mascot
				data-hopping={hopping ? "" : undefined}
				onClick={() => setHopping(true)}
				onAnimationEnd={() => setHopping(false)}
				className="clawd-mascot pointer-events-none absolute right-[-16px] bottom-[-13px] h-[80px] w-[80px] -scale-x-100 cursor-default border-0 bg-transparent p-0 outline-none [&_path]:pointer-events-auto"
			>
				<svg viewBox="0 0 2750 1850" width="100%" height="100%" shapeRendering="crispEdges">
					<path d={BODY} fill="#d97757" />
					<path d={EYES} fill="#141413" />
				</svg>
			</button>
		</div>
	);
}
