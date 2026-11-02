import {useCallback, useEffect, useRef, type RefObject} from "react";

import {clearJumpFlash, releaseEndFollow, TRANSCRIPT_JUMP_REQUEST_EVENT} from "../lib/jump-to-message";
import {chapterAnchorId, type SessionChapter} from "../lib/session-chapters";

/** How long a jump waits for its chapter's heading to mount while history pages in. */
const HEADING_WAIT_MS = 10_000;
/** How long Session start's smooth scroll gets before the jump lands at the top outright. */
const TOP_SETTLE_MS = 1_000;

/**
 * The session outline's jump (upstream's `scrollToTop` / `scrollToChapter`), over the local
 * virtualized, tail-loaded transcript.
 *
 * Session start scrolls smoothly to the top. Row measurements above the viewport re-place the
 * scroller as they land, which cuts a long smooth scroll short, so the jump then lands at the top
 * outright unless the reader has scrolled meanwhile.
 *
 * Any other chapter scrolls its heading to the top of the scroller. A heading that is not mounted
 * is revealed first: a loaded record through the transcript's own jump, by the chapter's record
 * index, and an unloaded one through the message jump, which pages history in. The heading is
 * scrolled to once it mounts, and the reveal's row flash is dropped.
 *
 * Every jump first releases the transcript's end-follow, which would otherwise pull it back down.
 */
export function useChapterJump(
	scrollRef: RefObject<HTMLElement | null>,
	requestMessageJump: (uuid: string) => void,
	/** The record index of the first loaded record. */
	windowStartIndex: number,
): (chapter: SessionChapter) => void
{
	const stopPending = useRef<(() => void) | undefined>(undefined);
	useEffect(
		() => () =>
		{
			stopPending.current?.();
		},
		[],
	);

	return useCallback(
		(chapter: SessionChapter) =>
		{
			stopPending.current?.();
			stopPending.current = undefined;
			const scroller = scrollRef.current;
			if (scroller === null) return;
			releaseEndFollow(scroller);

			if (chapter.source === "session")
			{
				scroller.scrollTo(
					{
						top: 0,
						behavior: "smooth",
					},
				);
				const stop = () =>
				{
					window.clearTimeout(timeout);
					scroller.removeEventListener("wheel", stop);
					scroller.removeEventListener("touchmove", stop);
					if (stopPending.current === stop) stopPending.current = undefined;
				};
				const timeout = window.setTimeout(() =>
				{
					stop();
					if (scroller.scrollTop > 0) scroller.scrollTop = 0;
				}, TOP_SETTLE_MS);
				scroller.addEventListener(
					"wheel",
					stop,
					{
						passive: true,
					},
				);
				scroller.addEventListener(
					"touchmove",
					stop,
					{
						passive: true,
					},
				);
				stopPending.current = stop;
				return;
			}

			const anchorId = chapterAnchorId(chapter.id);
			const mountedHeading = (): HTMLElement | null =>
			{
				const heading = document.getElementById(anchorId);
				return heading !== null && scroller.contains(heading) ? heading : null;
			};
			const mounted = mountedHeading();
			if (mounted !== null)
			{
				mounted.scrollIntoView(
					{
						block: "start",
						behavior: "smooth",
					},
				);
				return;
			}

			let frame = 0;
			const observer = new MutationObserver(() =>
			{
				if (frame !== 0 || mountedHeading() === null) return;
				observer.disconnect();
				// Two frames, so this lands after the transcript jump's own centring scroll, a frame after it mounts the row.
				frame = requestAnimationFrame(() =>
				{
					frame = requestAnimationFrame(() =>
					{
						frame = 0;
						stop();
						// The transcript jump flashes the row it revealed; upstream's chapter jump has no flash.
						clearJumpFlash(scroller);
						mountedHeading()?.scrollIntoView(
							{
								block: "start",
								behavior: "smooth",
							},
						);
					});
				});
			});
			const stop = () =>
			{
				observer.disconnect();
				window.clearTimeout(timeout);
				if (frame !== 0) cancelAnimationFrame(frame);
				if (stopPending.current === stop) stopPending.current = undefined;
			};
			const timeout = window.setTimeout(stop, HEADING_WAIT_MS);
			stopPending.current = stop;
			observer.observe(
				scroller,
				{
					childList: true,
					subtree: true,
				},
			);

			if (chapter.recordIndex >= windowStartIndex)
			{
				window.dispatchEvent(
					new CustomEvent<number>(
						TRANSCRIPT_JUMP_REQUEST_EVENT,
						{
							detail: chapter.recordIndex,
						},
					),
				);
			}
			else
			{
				requestMessageJump(chapter.uuid);
			}
		},
		[scrollRef, requestMessageJump, windowStartIndex],
	);
}
