import {useEffect, useState, type RefObject} from "react";

/**
 * Upstream's read gate states (claude.ai/code cc32965c2 `ml`): the watched text has no layout yet, has not been
 * seen to its end, or has been read.
 */
export type ReadGateState = "unlaid" | "unread" | "read";

export interface ReadGateReport
{
	/** Undefined until the first measure. */
	state: ReadGateState | undefined;
	/** The card's scroller shows all of its content (upstream `pl`); undefined until the first measure. */
	fits: boolean | undefined;
}

/** Upstream's slack: a line box may sit 2px outside the visible box and still count as seen. */
const SLACK = 2;
/** The card body that scrolls the watched element. */
const SCROLLER = "[data-approval-card-body]";

/** The document's font set; jsdom has none. */
function fontsOf(doc: Document): FontFaceSet | undefined
{
	const fonts: FontFaceSet | undefined = doc.fonts;
	return fonts;
}

function padding(element: HTMLElement, side: "paddingTop" | "paddingBottom"): number
{
	const value = Number.parseFloat(getComputedStyle(element)[side]);
	return Number.isFinite(value) ? value : 0;
}

/**
 * Upstream `ol`: whether the element's first or last line box (`height` tall) is inside the window and the
 * scroller's visible box, within the slack. A zero-height element counts as seen.
 */
function lineVisible(element: Element, scroller: HTMLElement | null, height: number, edge: "first" | "last"): boolean
{
	const rect = element.getBoundingClientRect();
	if (rect.height === 0) return true;
	const top = edge === "first" ? rect.top : rect.bottom - height;
	const bottom = edge === "first" ? rect.top + height : rect.bottom;
	const win = element.ownerDocument.defaultView ?? window;
	if (top < -SLACK || bottom > win.innerHeight + SLACK) return false;
	if (scroller === null) return true;
	const box = scroller.getBoundingClientRect();
	return top >= box.top - SLACK && bottom <= box.bottom + SLACK;
}

/**
 * Upstream's rows read gate (`ml`): watches the element (a gated rows panel) inside the card's scrolling body and
 * reports `read` once its head, its first row and its end have each been on screen; each sighting latches until
 * `gateKey` changes. `fits` says whether the body shows everything without scrolling, which a loose gate
 * needs before it is enforced. Re-measures on any scroll, window resize, element resize and font load.
 */
export function useRowsReadGate({
	ref,
	watched,
	gateKey,
}: {
	ref: RefObject<HTMLElement | null>;
	watched: boolean;
	/** The gated text's identity: a new key starts unread. */
	gateKey: string;
}): ReadGateReport
{
	const [report, setReport] = useState<
		ReadGateReport &
		{
			key: string | null;
		}
	>(
		{
			key: null,
			state: undefined,
			fits: undefined,
		},
	);
	useEffect(() =>
	{
		const element = ref.current;
		if (!watched || element === null) return undefined;
		const seen = new Set<string>();
		const see = (key: string, visible: () => boolean) =>
		{
			if (!seen.has(key) && visible()) seen.add(key);
			return seen.has(key);
		};
		const publish = (state: ReadGateState, fits: boolean) =>
		{
			setReport((previous) =>
				previous.key === gateKey && previous.state === state && previous.fits === fits
					? previous
					:
						{
							key: gateKey,
							state,
							fits,
						},
			);
		};
		const check = () =>
		{
			const scroller = element.closest<HTMLElement>(SCROLLER);
			const fits = scroller === null || scroller.scrollHeight <= scroller.clientHeight + SLACK;
			if (element.clientHeight === 0)
			{
				publish("unlaid", fits);
				return;
			}
			const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
			if (!Number.isFinite(lineHeight))
			{
				publish("unread", fits);
				return;
			}
			const firstRow = element.querySelector("li");
			const head = see("head", () =>
				lineVisible(element, scroller, lineHeight + padding(element, "paddingTop"), "first"),
			);
			const row =
				firstRow === null || see("firstRow", () => lineVisible(firstRow, scroller, lineHeight, "first"));
			const end = see("end", () =>
				lineVisible(element, scroller, lineHeight + padding(element, "paddingBottom"), "last"),
			);
			publish(head && row && end ? "read" : "unread", fits);
		};
		check();
		const doc = element.ownerDocument;
		const win = doc.defaultView ?? window;
		doc.addEventListener(
			"scroll",
			check,
			{
				capture: true,
				passive: true,
			},
		);
		win.addEventListener("resize", check);
		let observer: ResizeObserver | null = null;
		if (typeof ResizeObserver !== "undefined")
		{
			observer = new ResizeObserver(check);
			observer.observe(element);
			const scroller = element.closest<HTMLElement>(SCROLLER);
			if (scroller !== null) observer.observe(scroller);
		}
		let live = true;
		const fonts = fontsOf(doc);
		if (fonts !== undefined)
		{
			void fonts.ready.then(() =>
			{
				if (live) check();
			});
		}
		return () =>
		{
			live = false;
			doc.removeEventListener(
				"scroll",
				check,
				{
					capture: true,
				},
			);
			win.removeEventListener("resize", check);
			observer?.disconnect();
		};
	}, [ref, watched, gateKey]);
	return report.key === gateKey
		?
			{
				state: report.state,
				fits: report.fits,
			}
		:
			{
				state: undefined,
				fits: undefined,
			};
}
