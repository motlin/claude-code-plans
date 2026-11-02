/**
 * Upstream's image-viewer open/close morph (shared-10 `dqQ`, decoded in
 * .llm/upstream-sync/dumps/image-viewer-bundle.txt): a View Transition that
 * morphs the clicked thumbnail into the active image and back, a crossfade
 * when there is no thumbnail, and nothing under reduced motion (the OS query or html[data-reduce-motion=true]). The
 * thumbnail stays visibility:hidden while the viewer is open. The composer's
 * ImagePreviewModal (cb1b78cfa, shared-10 `Uy`) reuses it under its own name.
 */

import {isMotionReduced} from "./reduced-motion";

const MORPH_NAME = "image-viewer-morph";

interface TransitionDocument
{
	startViewTransition?: (update: () => void) =>
	{
		finished: Promise<unknown>;
	};
}

/** Starts a view transition running `update`, or runs it at once when motion is unwanted or unsupported. */
export function morph(update: () => void, onFinished?: () => void): boolean
{
	const start = (document as TransitionDocument).startViewTransition;
	if (start === undefined || isMotionReduced())
	{
		update();
		return false;
	}
	const transition = start.call(document, update);
	if (onFinished !== undefined) void transition.finished.finally(onFinished);
	return true;
}

/** Names (or unnames) one end of the morph; the composer's image preview passes its own `chat-image-preview`. */
export function setMorphName(element: HTMLElement | null, named: boolean, name: string = MORPH_NAME): void
{
	if (element !== null) element.style.viewTransitionName = named ? name : "";
}
