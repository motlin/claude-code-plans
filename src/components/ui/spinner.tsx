import {useEffect, useState} from "react";

/** Upstream cds Spinner box/stroke per size; md is the 16px ring the palette input row uses, sm the 12px busy-button ring. */
const SPINNER_SIZES = {sm: {box: "0.75rem", stroke: "1.5px"}, md: {box: "1rem", stroke: "1.75px"}} as const;

/** Track and arc colours: the muted ring on a surface, or upstream's busy-button ring drawn in the button's own ink. */
const SPINNER_TONES = {
	muted: {track: "var(--color-border)", arc: "var(--color-ink-muted)"},
	current: {track: "color-mix(in srgb, currentColor 25%, transparent)", arc: "currentColor"},
} as const;

/** Upstream mounts the sr-only label 100ms after the spinner shows, so a quick flash isn't announced. */
const LABEL_DELAY_MS = 100;

/**
 * Upstream's cds Spinner (shared-frame-B `Jz`): a muted conic arc spinning over a border-coloured track.
 * It renders nothing until `delay` ms have passed; with a `label` it sits in a `role=status` span whose
 * sr-only label mounts 100ms after the ring appears.
 */
export function Spinner({
	size = "md",
	delay = 0,
	label,
	tone = "muted",
}: {
	size?: keyof typeof SPINNER_SIZES;
	tone?: keyof typeof SPINNER_TONES;
	delay?: number;
	label?: string;
}) {
	const [elapsed, setElapsed] = useState(delay <= 0);
	useEffect(() => {
		if (delay <= 0) return undefined;
		const timer = window.setTimeout(() => {
			setElapsed(true);
		}, delay);
		return () => {
			window.clearTimeout(timer);
		};
	}, [delay]);
	const show = delay <= 0 || elapsed;

	const {box, stroke} = SPINNER_SIZES[size];
	const {track, arc} = SPINNER_TONES[tone];
	const mask = `radial-gradient(farthest-side, transparent calc(100% - ${stroke}), #000 calc(100% - ${stroke} + 0.5px))`;
	const ring = show ? (
		<span
			data-spinner=""
			aria-hidden="true"
			className="relative inline-block shrink-0 align-middle"
			style={{width: box, height: box}}
		>
			<span className="absolute inset-0 rounded-full" style={{border: `${stroke} solid ${track}`}} />
			<span
				className="absolute inset-0 rounded-full animate-[spin_1s_linear_infinite] motion-reduce:animate-none"
				style={{background: `conic-gradient(transparent 40%, ${arc})`, mask}}
			/>
		</span>
	) : null;

	if (label === undefined) return ring;
	return (
		<span role="status" className="leading-[0]">
			{ring}
			{show && <SpinnerLabel>{label}</SpinnerLabel>}
		</span>
	);
}

function SpinnerLabel({children}: {children: string}) {
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		const timer = window.setTimeout(() => {
			setVisible(true);
		}, LABEL_DELAY_MS);
		return () => {
			window.clearTimeout(timer);
		};
	}, []);
	return visible ? <span className="sr-only">{children}</span> : null;
}
