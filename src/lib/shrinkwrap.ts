/**
 * Upstream's shrinkwrap engine (claude.ai/code `shared-frame`: `Ap`/`A4`/`y8`/`GT`, `zw`, `sm`, `pS`, `ud`, `mX`,
 * `er`, `lm`, `cU`, the per-window job queue `vt`/`qo`/`MS`/`Up`, the shared ResizeObserver `PV`/`q6`/`w_`/`$8`,
 * the shared `loadingdone` listener `lb`/`DK`, the remount memory `e3`/`Mx`/`jm`/`t9`, and `xT`).
 *
 * A wrapped flex item capped by a percentage max-width takes the whole cap even when its lines end short of it.
 * The engine measures where the text actually ends and writes an inline `max-width` (px) so the box hugs its widest
 * line, verifying that every line keeps its width (so no line rewraps) before it keeps the value.
 */

/** Children with this attribute set to `fill` never widen the fit; they fill the width the text sets. */
export const SHRINKWRAP_ATTR = "data-shrinkwrap";
export const SHRINKWRAP_FILL = "fill";

const MAX_BISECT_PROBES = 12;
const ANCESTORS = 16;
const MEMORY_ENTRIES = 512;
const MEMORY_TEXT_LIMIT = 20_000;
const FNV_OFFSET = 2166136261;
const REPLACED = new Set([
	"IMG",
	"SVG",
	"VIDEO",
	"AUDIO",
	"CANVAS",
	"IFRAME",
	"EMBED",
	"OBJECT",
	"PICTURE",
	"INPUT",
	"TEXTAREA",
	"SELECT",
	"PROGRESS",
	"METER",
]);

// --- inline max-width bookkeeping (Ap/A4/y8/GT): never clobber a caller's own style.maxWidth ---

const original = new WeakMap<HTMLElement, string>();
const written = new WeakMap<HTMLElement, string>();

function apply(el: HTMLElement, value: string): void
{
	el.style.maxWidth = value;
	written.set(el, value);
}

function authorMaxWidth(el: HTMLElement): string
{
	const current = el.style.maxWidth;
	return original.has(el) && current === written.get(el) ? (original.get(el) ?? "") : current;
}

function remember(el: HTMLElement): void
{
	original.set(el, authorMaxWidth(el));
}

function restore(el: HTMLElement): void
{
	if (original.has(el))
	{
		remember(el);
		apply(el, original.get(el) ?? "");
	}
}

/** `GT`: put back the element's own inline max-width, dropping any fitted value. */
export const restoreShrinkwrap = restore;

// --- measurement (zw/_u/sm/pS/ud) ---

/** Upstream tests `boxSizing === "border-box"`; a computed value is only ever that or content-box. */
function isBorderBox(style: CSSStyleDeclaration): boolean
{
	return style.boxSizing !== "content-box";
}

function isElement(node: Node): node is Element
{
	return node.nodeType === 1;
}

/** `document.fonts`, which upstream treats as optional (it is missing in some embedded webviews). */
function fontsOf(el: Element): FontFaceSet | undefined
{
	const fonts: FontFaceSet | undefined = el.ownerDocument.fonts;
	return fonts;
}

type Rect =
{
	left: number;
	right: number;
	width: number;
};

type Collected =
{
	rects: Rect[];
	left: number;
	right: number;
	clipped: number;
	boundLeft: number;
	boundRight: number;
};

type Metrics =
{
	height: number;
	overflow: number;
	client: number;
	spill: number;
	clipped: number;
	widths: number[];
};

function isInlineLevel(el: Element, style: CSSStyleDeclaration): boolean
{
	return REPLACED.has(el.tagName.toUpperCase()) || style.display.startsWith("inline");
}

function collect(el: HTMLElement, stop?: (span: number) => boolean): Collected
{
	const doc = el.ownerDocument;
	const win = doc.defaultView;
	const rects: Rect[] = [];
	let left = Infinity;
	let right = -Infinity;
	let clipped = 0;
	let boundLeft = Infinity;
	let boundRight = -Infinity;
	const line = (r: Rect) =>
	{
		rects.push(r);
		if (r.left < left) left = r.left;
		if (r.right > right) right = r.right;
	};
	const bound = (r: Rect) =>
	{
		if (r.left < boundLeft) boundLeft = r.left;
		if (r.right > boundRight) boundRight = r.right;
	};
	const underFill = (node: Node) =>
	{
		for (let e: Element | null = isElement(node) ? node : node.parentElement; e && e !== el; e = e.parentElement)
		{
			if (e.getAttribute(SHRINKWRAP_ATTR) === SHRINKWRAP_FILL) return true;
		}
		return false;
	};
	const range = doc.createRange();
	const walker = doc.createTreeWalker(
		el,
		5,
		{
			acceptNode: (node) =>
			{
				if (isElement(node))
				{
					const style = win?.getComputedStyle(node);
					return style &&
						(style.display === "none" || style.position === "absolute" || style.position === "fixed")
						? 2
						: 1;
				}
				return underFill(node) ? 2 : 1;
			},
		},
	);
	for (let node = walker.nextNode(); node; node = walker.nextNode())
	{
		if (isElement(node))
		{
			const child = node;
			const style = win?.getComputedStyle(child);
			const box = child.getBoundingClientRect();
			if (box.width > 0) bound(box);
			if (style && !underFill(child) && isInlineLevel(child, style))
			{
				for (const r of child.getClientRects()) if (r.width > 0) line(r);
			}
			if (style && (style.overflowX !== "visible" || style.overflowY !== "visible"))
			{
				clipped +=
					Math.max(0, child.scrollWidth - child.clientWidth) +
					Math.max(0, child.scrollHeight - child.clientHeight);
			}
		}
		else
		{
			range.selectNodeContents(node);
			for (const r of range.getClientRects())
			{
				if (r.width > 0)
				{
					line(r);
					bound(r);
				}
			}
		}
		if (stop && right > left && stop(right - left)) break;
	}
	return {
		rects,
		left,
		right,
		clipped,
		boundLeft,
		boundRight,
	};
}

function metrics(el: HTMLElement, {rects, clipped, boundLeft, boundRight}: Collected): Metrics
{
	const style = el.ownerDocument.defaultView?.getComputedStyle(el);
	const box = el.getBoundingClientRect();
	let spill = 0;
	if (style && Number.isFinite(boundLeft))
	{
		const width = parseFloat(style.width);
		const borderBox = isBorderBox(style)
			? width
			: width +
				parseFloat(style.paddingLeft) +
				parseFloat(style.paddingRight) +
				parseFloat(style.borderLeftWidth) +
				parseFloat(style.borderRightWidth);
		const scale = (borderBox > 0 && box.width / borderBox) || 1;
		const contentLeft = box.left + (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * scale;
		const contentRight = box.right - (parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight)) * scale;
		spill = Math.max(0, boundRight - contentRight) + Math.max(0, contentLeft - boundLeft);
	}
	return {
		height: el.scrollHeight,
		overflow: el.scrollWidth,
		client: el.clientWidth,
		spill,
		clipped,
		widths: rects.map((r) => r.width),
	};
}

function sameWidths(a: Metrics, b: Metrics): boolean
{
	return a.widths.length === b.widths.length && a.widths.every((w, i) => Math.abs(w - (b.widths[i] ?? NaN)) <= 0.5);
}

/** `pS`: the probe kept every line and introduced no growth, overflow, spill or clipping. */
function unchanged(natural: Metrics, probe: Metrics): boolean
{
	if (
		probe.height > natural.height ||
		probe.overflow > probe.client + 0.5 ||
		probe.spill > natural.spill + 0.5 ||
		probe.clipped > natural.clipped + 0.5
	)
	{
		return false;
	}
	return sameWidths(natural, probe);
}

/** `ud`: the probe kept every line yet the box got shorter, so the fit would change layout. */
function shrank(natural: Metrics, probe: Metrics): boolean
{
	return (probe.height < natural.height || probe.clipped < natural.clipped - 0.5) && sameWidths(natural, probe);
}

function verify(el: HTMLElement, natural: Metrics | null): boolean | "shrank"
{
	if (natural === null) return false;
	const probe = metrics(el, collect(el));
	return shrank(natural, probe) ? "shrank" : unchanged(natural, probe);
}

// --- jobs (Xl/nN/mX/lm/cU) ---

type Stage = "read" | "verify" | "nudge1" | "nudge2" | "bisect" | "settled";

type Job =
{
	el: HTMLElement;
	done: (width: number | null) => void;
	lookup: boolean;
	remember: boolean;
	key: string | null | undefined;
	rules: string;
	width: number | null;
	boxWidth: number;
	natural: Metrics | null;
	candidate: number;
	stage: Stage;
	lo: number;
	hi: number;
	probes: number;
	resizeDue: boolean;
};

function newJob(
	el: HTMLElement,
	done: (width: number | null) => void,
	options:
	{
		lookup?: boolean;
		remember?: boolean;
	} = {},
): Job
{
	return {
		el,
		done,
		lookup: options.lookup ?? false,
		remember: options.remember ?? false,
		key: undefined,
		rules: "",
		width: null,
		boxWidth: 0,
		natural: null,
		candidate: 0,
		stage: "read",
		lo: 0,
		hi: 0,
		probes: 0,
		resizeDue: false,
	};
}

function settle(job: Job, width: number | null): void
{
	if (width === null) restore(job.el);
	else apply(job.el, `${width}px`);
	job.stage = "settled";
	job.width = width;
	job.done(width);
}

function wrapRules(style: CSSStyleDeclaration): string
{
	return [
		style.whiteSpace,
		style.wordBreak,
		style.overflowWrap,
		style.hyphens,
		style.lineBreak,
		style.textWrap,
		style.textAlign,
	].join("|");
}

/** `mX`: measure the natural layout and pick the candidate width, or settle with no style. */
function read(job: Job): void
{
	const {el} = job;
	const win = el.ownerDocument.defaultView;
	if (!win || typeof el.getBoundingClientRect !== "function")
	{
		settle(job, null);
		return;
	}
	const style = win.getComputedStyle(el);
	const width = parseFloat(style.width);
	if (!Number.isFinite(width) || width <= 0)
	{
		settle(job, null);
		return;
	}
	const borderBox = isBorderBox(style);
	const pad =
		parseFloat(style.paddingLeft) +
		parseFloat(style.paddingRight) +
		parseFloat(style.borderLeftWidth) +
		parseFloat(style.borderRightWidth);
	const scale = el.getBoundingClientRect().width / (borderBox ? width : width + pad) || 1;
	const toCss = (span: number) =>
	{
		const css = span / scale;
		return Math.ceil((borderBox ? css + pad : css) - 0.001);
	};
	const tight = (span: number) => toCss(span) >= width - 0.5;
	const collected = collect(el, tight);
	if (collected.rects.length === 0)
	{
		settle(job, null);
		return;
	}
	const span = collected.right - collected.left;
	if (tight(span))
	{
		settle(job, null);
		return;
	}
	job.natural = metrics(el, collected);
	job.rules = job.remember ? wrapRules(style) : "";
	job.boxWidth = width;
	job.candidate = toCss(span);
	job.stage = "verify";
}

/** `lm`: advance verify → nudge +1 → nudge +2 → bisect; returns the next width to probe, or null when settled. */
function step(job: Job, ok: boolean): number | null
{
	const {boxWidth} = job;
	if (job.stage === "verify")
	{
		if (ok) return (settle(job, job.candidate), null);
		job.stage = "nudge1";
		if (job.candidate + 1 < boxWidth) return job.candidate + 1;
		job.stage = "bisect";
	}
	else if (job.stage === "nudge1")
	{
		if (ok) return (settle(job, job.candidate + 1), null);
		job.stage = "nudge2";
		if (job.candidate + 2 < boxWidth) return job.candidate + 2;
		job.stage = "bisect";
	}
	else if (job.stage === "nudge2")
	{
		if (ok) return (settle(job, job.candidate + 2), null);
		job.stage = "bisect";
	}
	else if (job.stage === "bisect")
	{
		job.probes += 1;
		const mid = job.lo > 0 ? Math.floor((job.lo + job.hi) / 2) : NaN;
		if (ok) job.hi = mid;
		else job.lo = mid;
	}
	if (job.stage !== "bisect") return null;
	if (job.lo === 0)
	{
		job.lo = job.candidate + 2;
		job.hi = Math.ceil(boxWidth);
	}
	if (job.probes >= MAX_BISECT_PROBES || job.hi - job.lo <= 1)
	{
		settle(job, job.hi < boxWidth - 0.5 ? job.hi : null);
		return null;
	}
	return Math.floor((job.lo + job.hi) / 2);
}

/** `cU`: fit a batch together, alternating one write pass and one read pass per round (at most 16 rounds). */
function fitBatch(jobs: Job[]): void
{
	for (const job of jobs)
	{
		remember(job.el);
		restore(job.el);
	}
	for (const job of jobs) read(job);
	let active = jobs.filter((job) => job.stage === "verify");
	for (const job of active) apply(job.el, `${job.candidate}px`);
	for (let round = 0; active.length > 0 && round < 16; round++)
	{
		const results = active.map((job) => [job, verify(job.el, job.natural)] as const);
		const next: [Job, number][] = [];
		for (const [job, result] of results)
		{
			if (result === "shrank")
			{
				settle(job, null);
				continue;
			}
			const width = step(job, result);
			if (width !== null) next.push([job, width]);
		}
		for (const [job, width] of next) apply(job.el, `${width}px`);
		active = next.map(([job]) => job);
	}
	for (const job of active) if (job.stage !== "settled") settle(job, null);
}

/** `yr`: fit one element synchronously; returns the applied width, or null when no inline style was kept. */
export function fitShrinkwrap(el: HTMLElement): number | null
{
	let width: number | null = null;
	fitBatch([
		newJob(el, (w) =>
		{
			width = w;
		}),
	]);
	return width;
}

// --- remount memory (e3/lG/Mx/Gm/Qj/E7/GU/N2/R2/jm/rB/pk/t9) ---

type Known =
{
	width: number | null;
	natural: Metrics;
	rooms: number[];
	content: number;
	rules: string;
};

const memory = new WeakMap<Document, Map<string, Known>>();

function storeKnown(doc: Document, key: string, known: Known): void
{
	let entries = memory.get(doc);
	if (!entries)
	{
		entries = new Map();
		memory.set(doc, entries);
	}
	entries.delete(key);
	entries.set(key, known);
	if (entries.size > MEMORY_ENTRIES)
	{
		const oldest = entries.keys().next().value;
		if (oldest !== undefined) entries.delete(oldest);
	}
}

function recall(el: HTMLElement, key: string): Known | undefined
{
	return memory.get(el.ownerDocument)?.get(key);
}

function fnv(seed: number, text: string): number
{
	let hash = seed;
	for (let i = 0; i < text.length; i++)
	{
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function styleWithoutMaxWidth(el: Element): string
{
	const style = (el.getAttribute("style") ?? "").replace(/(^|;)\s*max-width:[^;]*;?/g, "$1");
	return el instanceof HTMLElement ? `${style}|${authorMaxWidth(el)}` : style;
}

/** `Mx`: className, density, text size, lang, a hash of the descendant tags/classes/styles, and the text hash. */
function memoryKey(el: HTMLElement): string | null
{
	const text = el.textContent;
	if (text.length === 0 || text.length > MEMORY_TEXT_LIMIT) return null;
	const density = el.closest("[data-density]")?.getAttribute("data-density") ?? "";
	const textSize = el.closest("[data-text-size]")?.getAttribute("data-text-size") ?? "";
	const lang = el.closest("[lang]")?.getAttribute("lang") ?? "";
	const descendants = el.getElementsByTagName("*");
	let hash = FNV_OFFSET;
	for (const child of descendants)
	{
		hash = fnv(hash, child.tagName);
		hash = fnv(hash, child.getAttribute("class") ?? "");
		hash = fnv(hash, styleWithoutMaxWidth(child));
		hash = fnv(hash, child.getAttribute(SHRINKWRAP_ATTR) ?? "");
		hash = fnv(hash, "|");
	}
	return [el.className, density, textSize, lang, descendants.length, hash, text.length, fnv(FNV_OFFSET, text)].join(
		"|",
	);
}

function ancestorWidths(el: HTMLElement): number[]
{
	const widths: number[] = [];
	for (let p = el.parentElement, n = 0; p && n < ANCESTORS; p = p.parentElement, n++) widths.push(p.offsetWidth);
	return widths;
}

function sameRooms(el: HTMLElement, rooms: number[]): boolean
{
	const now = ancestorWidths(el);
	return now.length === rooms.length && now.every((w, i) => Math.abs(w - (rooms[i] ?? 0)) <= 1);
}

function contentWidth(el: HTMLElement): number
{
	const parent = el.parentElement;
	const style = parent?.ownerDocument.defaultView?.getComputedStyle(parent);
	return !parent || !style
		? 0
		: parent.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
}

function sameRules(el: HTMLElement, rules: string): boolean
{
	const style = el.ownerDocument.defaultView?.getComputedStyle(el);
	return style !== undefined && wrapRules(style) === rules;
}

/** `jm`: store a settled fit so a remount can re-apply it without probing. */
function store(job: Job, width: number | null): void
{
	const {el} = job;
	if (!job.remember || job.natural === null || authorMaxWidth(el) !== "" || fontsOf(el)?.status === "loading")
	{
		return;
	}
	const key = job.key === undefined ? memoryKey(el) : job.key;
	const rooms = ancestorWidths(el);
	if (key === null || rooms.every((w) => w <= 0)) return;
	storeKnown(
		el.ownerDocument,
		key,
		{
			width,
			natural: job.natural,
			rooms,
			content: contentWidth(el),
			rules: job.rules,
		},
	);
}

function lookupKnown(job: Job):
	|
	  {
			job: Job;
			key: string;
			known: Known;
	  }
	| undefined
{
	if (!job.lookup) return undefined;
	job.lookup = false;
	remember(job.el);
	if (authorMaxWidth(job.el) !== "")
	{
		job.remember = false;
		return undefined;
	}
	job.key = memoryKey(job.el);
	const known = job.key === null ? undefined : recall(job.el, job.key);
	return known && job.key !== null
		?
			{
				job,
				key: job.key,
				known,
			}
		: undefined;
}

/** `t9`: re-apply remembered widths, keep the ones that still verify, and return the jobs that need a full fit. */
function applyRemembered(jobs: Job[]): Job[]
{
	const hits:
	{
		job: Job;
		key: string;
		known: Known;
	}[] = [];
	const misses: Job[] = [];
	for (const job of jobs)
	{
		const hit = lookupKnown(job);
		if (hit) hits.push(hit);
		else misses.push(job);
	}
	for (const {job, known} of hits)
	{
		if (known.width === null) restore(job.el);
		else apply(job.el, `${known.width}px`);
	}
	for (const {job, key, known} of hits)
	{
		const {el} = job;
		if (
			sameRooms(el, known.rooms) &&
			Math.abs(contentWidth(el) - known.content) <= 1 &&
			sameRules(el, known.rules) &&
			verify(el, known.natural) === true
		)
		{
			job.stage = "settled";
			job.width = known.width;
			job.done(known.width);
			storeKnown(el.ownerDocument, key, known);
		}
		else
		{
			misses.push(job);
		}
	}
	return misses;
}

// --- per-window job queue (vt/CT/a8/MS/Up/qo/Ev) ---

type Queue =
{
	queue: Map<HTMLElement, Job>;
	microtaskQueued: boolean;
	frameQueued: number;
};

const queues = new WeakMap<Window, Queue>();

function queueFor(win: Window): Queue
{
	let q = queues.get(win);
	if (!q)
	{
		q =
		{
			queue: new Map(),
			microtaskQueued: false,
			frameQueued: 0,
		};
		queues.set(win, q);
	}
	return q;
}

function run(win: Window, q: Queue, jobs: Job[]): void
{
	const pending = applyRemembered(jobs);
	if (pending.length > 0)
	{
		fitBatch(pending);
		for (const job of pending) if (job.stage === "settled") store(job, job.width);
	}
	if (q.queue.size > 0) return;
	if (q.frameQueued)
	{
		win.cancelAnimationFrame(q.frameQueued);
		q.frameQueued = 0;
	}
	if (!q.microtaskQueued) queues.delete(win);
}

function flush(win: Window): void
{
	const q = queues.get(win);
	if (!q) return;
	q.microtaskQueued = false;
	if (q.frameQueued)
	{
		win.cancelAnimationFrame(q.frameQueued);
		q.frameQueued = 0;
	}
	const jobs = [...q.queue.values()];
	q.queue.clear();
	run(win, q, jobs);
}

function flushResizes(win: Window): void
{
	const q = queues.get(win);
	if (!q) return;
	const jobs: Job[] = [];
	for (const [el, job] of q.queue)
	{
		if (job.resizeDue)
		{
			q.queue.delete(el);
			jobs.push(job);
		}
	}
	run(win, q, jobs);
}

type When = "microtask" | "frame" | "resize";

function schedule(
	el: HTMLElement,
	done: (width: number | null) => void,
	when: When,
	options:
	{
		lookup?: boolean;
		remember?: boolean;
	} = {},
): void
{
	const win = el.ownerDocument.defaultView;
	if (!win)
	{
		done(fitShrinkwrap(el));
		return;
	}
	const q = queueFor(win);
	let job = q.queue.get(el);
	if (job)
	{
		job.done = done;
		job.lookup ||= options.lookup ?? false;
		job.remember &&= options.remember ?? false;
	}
	else
	{
		job = newJob(el, done, options);
		q.queue.set(el, job);
	}
	if (when === "microtask")
	{
		if (!q.microtaskQueued)
		{
			q.microtaskQueued = true;
			queueMicrotask(() =>
			{
				flush(win);
			});
		}
	}
	else if (when === "resize")
	{
		job.resizeDue = true;
	}
	else if (!q.frameQueued && !q.microtaskQueued)
	{
		q.frameQueued = win.requestAnimationFrame(() =>
		{
			flush(win);
		});
	}
}

function unschedule(el: HTMLElement): void
{
	const win = el.ownerDocument.defaultView;
	if (!win) return;
	const q = queues.get(win);
	if (q)
	{
		q.queue.delete(el);
		run(win, q, []);
	}
}

// --- refit triggers (Iz, shared ResizeObserver PV/q6/w_/$8, shared loadingdone lb/DK) ---

type ResizeCheck =
{
	self: boolean;
	inline: number;
	block: number;
	prevInline: number;
	prevBlock: number;
	applied: number | null;
};

/** `Iz`: ancestors refit on an inline change >1px; the element on a block change, or an inline change away from the applied width. */
export function needsRefit(c: ResizeCheck): boolean
{
	if (c.self)
	{
		const atApplied = c.applied !== null && Math.abs(c.inline - c.applied) <= 1;
		return Math.abs(c.block - c.prevBlock) > 1 || (!atApplied && Math.abs(c.inline - c.prevInline) > 1);
	}
	return Math.abs(c.inline - c.prevInline) > 1;
}

/** Upstream falls back to contentRect where an entry has no borderBoxSize (older WebKit). */
function firstSize(sizes: readonly ResizeObserverSize[] | undefined): ResizeObserverSize | undefined
{
	return sizes?.[0];
}

type Observed =
{
	observer: ResizeObserver;
	handlers: Map<Element, Set<(entry: ResizeObserverEntry) => void>>;
	paused: Set<Element>;
	resumeQueued: number;
};

const observers = new WeakMap<Window, Observed>();

function observe(win: Window & typeof globalThis, el: Element, handler: (entry: ResizeObserverEntry) => void): void
{
	let shared = observers.get(win);
	if (!shared)
	{
		const handlers = new Map<Element, Set<(entry: ResizeObserverEntry) => void>>();
		shared =
		{
			observer: new win.ResizeObserver((entries) =>
			{
				for (const entry of entries) for (const h of handlers.get(entry.target) ?? []) h(entry);
				flushResizes(win);
			}),
			handlers,
			paused: new Set(),
			resumeQueued: 0,
		};
		observers.set(win, shared);
	}
	let set = shared.handlers.get(el);
	if (!set)
	{
		try
		{
			shared.observer.observe(el);
		}
		catch (error)
		{
			if (shared.handlers.size === 0) observers.delete(win);
			throw error;
		}
		set = new Set();
		shared.handlers.set(el, set);
	}
	set.add(handler);
}

function unobserve(win: Window, el: Element, handler: (entry: ResizeObserverEntry) => void): void
{
	const shared = observers.get(win);
	const set = shared?.handlers.get(el);
	if (!shared || !set) return;
	set.delete(handler);
	if (set.size === 0)
	{
		shared.handlers.delete(el);
		shared.paused.delete(el);
		shared.observer.unobserve(el);
	}
	if (shared.handlers.size === 0)
	{
		shared.observer.disconnect();
		if (shared.resumeQueued) win.cancelAnimationFrame(shared.resumeQueued);
		observers.delete(win);
	}
}

/** `$8`: stop watching an ancestor until the next frame, so the refit's own layout change doesn't echo back. */
function pause(win: Window, el: Element): void
{
	const shared = observers.get(win);
	if (!shared || !shared.handlers.has(el) || shared.paused.has(el)) return;
	shared.observer.unobserve(el);
	shared.paused.add(el);
	shared.resumeQueued ||= win.requestAnimationFrame(() =>
	{
		shared.resumeQueued = 0;
		for (const p of shared.paused) if (shared.handlers.has(p)) shared.observer.observe(p);
		shared.paused.clear();
	});
}

const fontListeners = new WeakMap<
	FontFaceSet,
	{
		refits: Set<() => void>;
		listener: () => void;
	}
>();

function onFontsLoaded(fonts: FontFaceSet | undefined, refit: () => void): () => void
{
	if (typeof fonts?.addEventListener !== "function") return () => undefined;
	let entry = fontListeners.get(fonts);
	if (!entry)
	{
		const refits = new Set<() => void>();
		const listener = () =>
		{
			for (const r of refits) r();
		};
		fonts.addEventListener("loadingdone", listener);
		entry =
		{
			refits,
			listener,
		};
		fontListeners.set(fonts, entry);
	}
	const current = entry;
	current.refits.add(refit);
	return () =>
	{
		current.refits.delete(refit);
		if (current.refits.size === 0 && fontListeners.get(fonts) === current)
		{
			fontListeners.delete(fonts);
			fonts.removeEventListener("loadingdone", current.listener);
		}
	};
}

/**
 * `xT`: fit `el` (in a microtask, or synchronously when `immediate`) and keep it fitted: refit on resizes of the
 * element and up to 16 ancestors, on subtree mutations and on web-font loads. Returns the cleanup, which disconnects
 * everything and restores the element's own inline max-width.
 */
export function attachShrinkwrap(
	el: HTMLElement,
	{
		immediate = false,
		remember: rememberFits = false,
	}:
	{
		immediate?: boolean;
		remember?: boolean;
	} = {},
): () => void
{
	const useMemory = rememberFits && !immediate;
	let disposed = false;
	let applied: number | null = null;
	const win = el.ownerDocument.defaultView;
	const sizes = new Map<
		Element,
		{
			inline: number;
			block: number;
		}
	>();
	const watched: HTMLElement[] = [];
	const snapshot = (target: HTMLElement) =>
	{
		sizes.set(
			target,
			{
				inline: target.offsetWidth,
				block: target.offsetHeight,
			},
		);
	};
	const resizeWin = win?.ResizeObserver ? win : null;
	let deepest = 0;
	const done = (width: number | null) =>
	{
		if (disposed) return;
		applied = width;
		for (const target of watched) snapshot(target);
		if (resizeWin && deepest > 0) for (const target of watched.slice(deepest)) pause(resizeWin, target);
		deepest = 0;
	};
	const refit = (when: When) =>
	{
		if (!disposed)
			schedule(
				el,
				done,
				when,
				{
					remember: useMemory && when !== "resize",
				},
			);
	};
	const onResize = (entry: ResizeObserverEntry) =>
	{
		const border = firstSize(entry.borderBoxSize);
		const inline = border ? border.inlineSize : entry.contentRect.width;
		const block = border ? border.blockSize : entry.contentRect.height;
		const prev = sizes.get(entry.target) ??
		{
			inline,
			block,
		};
		sizes.set(
			entry.target,
			{
				inline,
				block,
			},
		);
		const self = entry.target === el;
		if (
			needsRefit(
				{
					self,
					inline,
					block,
					prevInline: prev.inline,
					prevBlock: prev.block,
					applied,
				},
			)
		)
		{
			if (!self)
				deepest = Math.max(
					deepest,
					watched.findIndex((target) => target === entry.target),
				);
			refit(self ? "frame" : "resize");
		}
	};
	const watch = (target: HTMLElement) =>
	{
		if (resizeWin) observe(resizeWin, target, onResize);
		watched.push(target);
		if (immediate) snapshot(target);
	};
	let mutations: MutationObserver | null = null;
	let stopFonts: () => void = () => undefined;
	const dispose = () =>
	{
		disposed = true;
		unschedule(el);
		if (resizeWin) for (const target of watched) unobserve(resizeWin, target, onResize);
		mutations?.disconnect();
		stopFonts();
		restore(el);
	};
	try
	{
		if (immediate) applied = fitShrinkwrap(el);
		else
			schedule(
				el,
				done,
				"microtask",
				{
					lookup: useMemory,
					remember: useMemory,
				},
			);
		watch(el);
		for (let p = el.parentElement, n = 0; p && n < ANCESTORS; p = p.parentElement, n++) watch(p);
		if (win?.MutationObserver)
		{
			mutations = new win.MutationObserver(() =>
			{
				refit("microtask");
			});
			mutations.observe(
				el,
				{
					subtree: true,
					childList: true,
					characterData: true,
					attributes: true,
					attributeFilter: [SHRINKWRAP_ATTR],
				},
			);
		}
		const fonts = fontsOf(el);
		const onFonts = () =>
		{
			refit("microtask");
		};
		stopFonts = onFontsLoaded(fonts, onFonts);
		if (fonts && fonts.status !== "loaded")
		{
			try
			{
				void fonts.ready.then(onFonts, onFonts);
			}
			catch
			{
				// upstream ignores a fonts.ready getter that throws
			}
		}
	}
	catch (error)
	{
		try
		{
			dispose();
		}
		catch
		{
			// the original error wins
		}
		throw error;
	}
	return dispose;
}
