import
{
	type CSSProperties,
	memo,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {useReducedMotion} from "../../lib/reduced-motion";

/** Upstream's SW: the swap's leave, enter and width-glide duration. */
export const MORPH_MS = 180;

/** Upstream's UE (`cubic-bezier(${[.2,0,0,1].join(",")})`): the swap's easing, as WAAPI receives it. */
export const MORPH_EASE = "cubic-bezier(0.2,0,0,1)";

/** Upstream's CO: the entering face's CSS rise (`cds-morph-in` in globals.css). */
export const MORPH_ENTER_CLASS = "motion-safe:animate-[cds-morph-in_0.18s_cubic-bezier(.2,0,0,1)]";

/** Upstream's p1: a first frame later than this restarts the leave so a janky mount does not skip it. */
const LATE_FRAME_MS = 40;

const SLOT_CLASS = "group/morph inline-grid min-w-0 items-center justify-items-start data-[gliding]:overflow-x-clip";
const FACE_CLASS = "col-start-1 row-start-1 flex min-w-0 max-w-full items-center group-data-[gliding]/morph:max-w-none";

interface Pose
{
	opacity: number;
	y: number;
}

/** Upstream's x7 and yW: a face at rest, and where a leaving face ends. */
const REST: Pose =
{
	opacity: 1,
	y: 0,
};
const LEAVE: Pose =
{
	opacity: 0,
	y: -3,
};

function toFrame(pose: Pose): Keyframe
{
	return {
		opacity: pose.opacity,
		transform: `translateY(${pose.y}px)`,
	};
}

/** Upstream's Xh: a face's current opacity and vertical offset, read from its computed style. */
function readPose(element: HTMLElement): Pose | null
{
	const style = element.ownerDocument.defaultView?.getComputedStyle(element);
	if (!style) return null;
	const y = /,\s*(-?[\d.]+)\)$/.exec(style.transform)?.[1];
	return {
		opacity: style.opacity === "" ? 1 : Number(style.opacity),
		y: y === undefined ? 0 : Number(y),
	};
}

/** Upstream's WZ: how far a running animation has got, 1 once finished, null when idle. */
function progressOf(animation: Animation | undefined): number | null
{
	if (animation?.playState === "finished") return 1;
	if (animation?.playState === "running") return animation.effect?.getComputedTiming().progress ?? null;
	return null;
}

/** Upstream's fS: whether this environment has WAAPI at all. */
function canAnimate(): boolean
{
	return typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.animate === "function";
}

/** Upstream's ry: Element.animate that never throws. */
function safeAnimate(
	element: HTMLElement,
	keyframes: Keyframe[],
	options: KeyframeAnimationOptions,
): Animation | undefined
{
	try
	{
		return element.animate(keyframes, options);
	}
	catch
	{
		return undefined;
	}
}

/** Upstream's ha: a face's computed opacity. */
function opacityOf(element: HTMLElement): number
{
	const opacity = element.ownerDocument.defaultView?.getComputedStyle(element).opacity;
	return opacity === undefined || opacity === "" ? 1 : Number(opacity);
}

/** Upstream's WV: hide an extra leaving face without letting it hold width in the grid cell. */
function collapse(element: HTMLElement, hidden: boolean): void
{
	element.style.visibility = hidden ? "hidden" : "";
	element.style.width = hidden ? "0px" : "";
	element.style.height = hidden ? "0px" : "";
	element.style.overflow = hidden ? "hidden" : "";
}

/** Upstream's Aj: the slot's content-box width, where an interrupted glide restarts from. */
function contentWidth(element: HTMLElement): number
{
	const width = element.getBoundingClientRect().width;
	const style = element.ownerDocument.defaultView?.getComputedStyle(element);
	if (style?.boxSizing !== "content-box") return width;
	return [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth].reduce(
		(rest, value) => rest - (Number.parseFloat(value) || 0),
		width,
	);
}

/** Upstream's uU: two frames in, wait for the element's animations to settle, then call back. */
function afterAnimations(element: HTMLElement, settle: () => void): () => void
{
	const view = element.ownerDocument.defaultView;
	if (!view)
		return () =>
		{
		};
	let live = true;
	let second: number | undefined;
	const first = view.requestAnimationFrame(() =>
	{
		second = view.requestAnimationFrame(() =>
		{
			const running = typeof element.getAnimations === "function" ? element.getAnimations() : [];
			void Promise.allSettled(running.map(async (animation) => animation.finished)).then(() =>
			{
				if (live) settle();
			});
		});
	});
	return () =>
	{
		live = false;
		view.cancelAnimationFrame(first);
		if (second !== undefined) view.cancelAnimationFrame(second);
	};
}

function noop(): void
{
}

/** Upstream's j9: a leaving face keeps rendering the children it had when it started to leave. */
const Frozen = memo(
	function Frozen({
		children,
	}: Readonly<
	{
		children: ReactNode;
		frozen: boolean;
	}>): ReactNode
	{
		return children;
	},
	(_previous, next) => next.frozen,
);

interface FaceProps
{
	faceKey: string;
	leaving: boolean;
	initialEnters: boolean;
	easesBack: boolean;
	onLeft: (key: string) => void;
	children: ReactNode;
}

/** Upstream's H5: one face of the slot, leaving by WAAPI or entering by the `cds-morph-in` class. */
function MorphFace({faceKey, leaving, initialEnters, easesBack, onLeft, children}: Readonly<FaceProps>)
{
	const ref = useRef<HTMLSpanElement>(null);
	const onLeftRef = useRef(onLeft);
	onLeftRef.current = onLeft;
	const left = useCallback(() =>
	{
		onLeftRef.current(faceKey);
	}, [faceKey]);
	const interrupted = useRef<Pose | null>(null);
	const enteringNow = useRef(initialEnters);

	useLayoutEffect(() =>
	{
		const element = ref.current;
		const from = interrupted.current;
		interrupted.current = null;
		if (!element || typeof element.animate !== "function")
		{
			if (leaving) left();
			return undefined;
		}
		if (!leaving && (from === null || !easesBack)) return undefined;
		const start = from ?? (leaving && enteringNow.current ? readPose(element) : null);
		const target = leaving ? LEAVE : REST;
		const animation = safeAnimate(
			element,
			start ? [toFrame(start), toFrame(target)] : [toFrame(target)],
			{
				duration: MORPH_MS,
				easing: MORPH_EASE,
				fill: leaving ? "both" : "backwards",
			},
		);
		if (leaving && typeof animation?.finished.then !== "function")
		{
			animation?.cancel();
			left();
			return undefined;
		}
		let live = true;
		const watch = () =>
		{
			animation?.finished.then(() =>
			{
				if (live && leaving) left();
			}, noop);
		};
		const view = element.ownerDocument.defaultView;
		const startedAt = performance.now();
		let frame: number | undefined;
		if (animation && view)
		{
			animation.startTime = startedAt;
			frame = view.requestAnimationFrame(() =>
			{
				if (!live) return;
				const now = performance.now();
				if (now - startedAt > LATE_FRAME_MS) animation.startTime = now;
				watch();
			});
		}
		else
		{
			watch();
		}
		const base = start ?? REST;
		return () =>
		{
			live = false;
			if (frame !== undefined) view?.cancelAnimationFrame(frame);
			const progress = progressOf(animation);
			if (progress !== null)
			{
				interrupted.current =
				{
					opacity: base.opacity + (target.opacity - base.opacity) * progress,
					y: base.y + (target.y - base.y) * progress,
				};
			}
			animation?.cancel();
		};
	}, [leaving, easesBack, left]);

	const [entering, setEntering] = useState(initialEnters);
	useEffect(() =>
	{
		enteringNow.current = entering;
	}, [entering]);
	const [generation, setGeneration] = useState(0);
	const [wasLeaving, setWasLeaving] = useState(leaving);
	if (wasLeaving !== leaving)
	{
		setWasLeaving(leaving);
		if (!leaving) setGeneration(generation + 1);
	}
	useEffect(() =>
	{
		const element = ref.current;
		if (!entering || !element) return undefined;
		return afterAnimations(element, () =>
		{
			setEntering(false);
		});
	}, [entering]);

	const enterClass = entering && generation === 0 ? ` ${MORPH_ENTER_CLASS}` : "";
	return (
		<span
			ref={ref}
			data-morph-key={faceKey}
			aria-hidden={leaving ? true : undefined}
			className={FACE_CLASS + enterClass}
		>
			<Frozen key={generation} frozen={leaving}>
				{children}
			</Frozen>
		</span>
	);
}

/** Upstream's XZ (tailwind-merge) for this slot: a host class repeated from the base moves to the end. */
function slotClass(className: string | undefined): string
{
	if (!className) return SLOT_CLASS;
	const host = new Set(className.split(/\s+/));
	return [...SLOT_CLASS.split(" ").filter((token) => !host.has(token)), className].join(" ");
}

interface GlideOwner
{
	owner: string;
	release: () => void;
}

export interface MorphSlotProps
{
	/** Changing this key cross-fades the old face out and the new face in, gliding the slot's width. */
	swapKey: string;
	id?: string;
	/** Spread onto the container first, like upstream's phrases-seat attribute. */
	attrs?: Readonly<Record<string, string | undefined>>;
	className?: string;
	style?: CSSProperties;
	children?: ReactNode;
}

/**
 * Upstream's cds MorphSlot (`fC`): a one-cell inline grid whose faces swap on `swapKey`. The old face
 * fades up 3px and out (WAAPI, then removed), the new one rises in with `cds-morph-in`, and the slot
 * glides between their widths under `data-gliding`. Reduced motion swaps at once with a single face.
 */
export function MorphSlot({swapKey, id, attrs, className, style, children}: Readonly<MorphSlotProps>)
{
	const reduced = useReducedMotion();
	const ref = useRef<HTMLSpanElement>(null);
	const [shownKey, setShownKey] = useState(swapKey);
	const [swapped, setSwapped] = useState(false);
	const [leavingKeys, setLeavingKeys] = useState<readonly string[]>([]);
	if (shownKey !== swapKey)
	{
		setShownKey(swapKey);
		setSwapped(true);
		setLeavingKeys(
			reduced || !canAnimate()
				? []
				: [...leavingKeys.filter((key) => key !== swapKey && key !== shownKey), shownKey].slice(-2),
		);
	}
	const onLeft = useCallback((key: string) =>
	{
		setLeavingKeys((keys) => (keys.includes(key) ? keys.filter((other) => other !== key) : keys));
	}, []);

	const glide = useRef<GlideOwner | null>(null);
	const latestKey = useRef(swapKey);
	const previousKey = useRef<string | null>(null);

	useLayoutEffect(() =>
	{
		if (latestKey.current !== swapKey)
		{
			previousKey.current = latestKey.current;
			latestKey.current = swapKey;
		}
		const slot = ref.current;
		if (!slot) return;
		let entering: HTMLElement | undefined;
		let measured: HTMLElement | undefined;
		const others: HTMLElement[] = [];
		for (const face of slot.children)
		{
			if (!(face instanceof HTMLElement)) continue;
			if (face.dataset["morphKey"] === swapKey)
			{
				collapse(face, false);
				entering = face;
			}
			else
			{
				others.push(face);
				if (face.dataset["morphKey"] === previousKey.current || !measured) measured = face;
			}
		}
		const measuredWidth = measured?.getBoundingClientRect().width ?? 0;
		let kept = measured;
		for (const face of others) if (kept !== undefined && opacityOf(face) > opacityOf(kept)) kept = face;
		const glides = !reduced && !!entering && !!measured && typeof slot.animate === "function";
		const running = glide.current;
		const from = glides && running ? contentWidth(slot) : measuredWidth;
		let to = 0;
		if (glides && entering)
		{
			running?.release();
			to = entering.getBoundingClientRect().width;
		}
		for (const face of others) collapse(face, face !== kept);
		if (!glides || !entering || !measured || Math.abs(from - to) < 0.5) return;
		const animation = safeAnimate(
			slot,
			[
				{
					width: `${from}px`,
				},
				{
					width: `${to}px`,
				},
			],
			{
				duration: MORPH_MS,
				easing: MORPH_EASE,
				fill: to < from ? "forwards" : "none",
			},
		);
		if (!animation) return;
		const data = slot.dataset;
		data["gliding"] = "";
		const owner = measured.dataset["morphKey"];
		function release(): void
		{
			animation?.cancel();
			delete data["gliding"];
			if (glide.current?.release === release) glide.current = null;
		}
		if (owner === undefined)
		{
			if (to < from)
			{
				animation.cancel();
				delete data["gliding"];
			}
			return;
		}
		glide.current =
		{
			owner,
			release,
		};
	}, [swapKey, reduced]);

	useLayoutEffect(() =>
	{
		const current = glide.current;
		if (current && !leavingKeys.includes(current.owner)) current.release();
	}, [leavingKeys]);

	useLayoutEffect(
		() => () =>
		{
			glide.current?.release();
		},
		[],
	);

	const faces = [...leavingKeys.filter((key) => key !== swapKey), swapKey];
	return (
		<span {...attrs} id={id} ref={ref} style={style} className={slotClass(className)}>
			{faces.map((key) => (
				<MorphFace
					key={key}
					faceKey={key}
					leaving={key !== swapKey}
					initialEnters={swapped && !reduced}
					easesBack={!reduced}
					onLeft={onLeft}
				>
					{key === swapKey ? children : null}
				</MorphFace>
			))}
		</span>
	);
}
