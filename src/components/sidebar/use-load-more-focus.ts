import {useEffect, useRef, useState, type MouseEvent, type RefObject} from "react";

/**
 * Upstream `X7`: keyboard activation always hands focus to the loaded rows; a mouse click on the
 * focused trigger only rescues focus if the trigger unmounts (the last page); any other click never moves it.
 */
type HandoffMode = "always" | "ifDropped" | null;

function handoffMode(event: MouseEvent<HTMLElement>): HandoffMode
{
	const trigger = event.currentTarget;
	if (event.detail === 0 || trigger.matches(":focus-visible")) return "always";
	return document.activeElement === trigger ? "ifDropped" : null;
}

interface PendingLoad
{
	known: ReadonlySet<string>;
	mode: HandoffMode;
	trigger: HTMLElement;
	sawFetching: boolean;
	onLanded: ((landedIds: readonly string[]) => void) | undefined;
	/** Set once the page landed: focus waits for the first loaded row to render. */
	landed: boolean;
}

/**
 * Upstream `Ok`: snapshots the loaded rows when a Load more sessions or count-0 Show more fetch starts,
 * waits for one fetching → idle cycle, reports the rows that landed, then moves focus to the first newly
 * loaded row (`always`), or only when focus fell to the body with the trigger gone (`ifDropped`, with
 * preventScroll; a pointerdown elsewhere cancels it).
 */
export function useLoadMoreFocus({
	loadedIds,
	displayedIds,
	isFetching,
	containerRef,
}: {
	loadedIds: readonly string[];
	/** Every shown session row, in display order. */
	displayedIds: readonly string[];
	isFetching: boolean;
	containerRef: RefObject<HTMLElement | null>;
}): (event: MouseEvent<HTMLElement>, onLanded?: (landedIds: readonly string[]) => void) => void
{
	const pending = useRef<PendingLoad | null>(null);
	// Bumped with the landed reveal so the focus handoff runs after the revealed rows render.
	const [landedTick, setLandedTick] = useState(0);
	const latestLoaded = useRef(loadedIds);
	latestLoaded.current = loadedIds;

	useEffect(() =>
	{
		const load = pending.current;
		if (load === null || load.landed) return;
		if (isFetching)
		{
			load.sawFetching = true;
			return;
		}
		if (!load.sawFetching) return;
		load.landed = true;
		const landedIds = loadedIds.filter((id) => !load.known.has(id));
		load.onLanded?.(landedIds);
		setLandedTick((tick) => tick + 1);
	}, [isFetching, loadedIds]);

	useEffect(() =>
	{
		const load = pending.current;
		if (load === null || !load.landed) return;
		pending.current = null;
		const active = document.activeElement;
		const focusDropped = active === null || active === document.body;
		const allowed =
			load.mode === "always"
				? focusDropped || active === load.trigger
				: load.mode === "ifDropped" && focusDropped && !load.trigger.isConnected;
		if (!allowed) return;
		const container = containerRef.current;
		if (container === null) return;
		const target = (id: string) =>
			container.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(id)}"] [data-row-main-button]`);
		const firstNew = displayedIds.find((id) => !load.known.has(id) && target(id) !== null);
		const fallback = displayedIds.toReversed().find((id) => target(id) !== null);
		const id = firstNew ?? fallback;
		if (id === undefined) return;
		target(id)?.focus(
			load.mode === "ifDropped"
				?
					{
						preventScroll: true,
					}
				: undefined,
		);
		// displayedIds is read as of the landed render; the effect must not re-run on later renders.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [landedTick, containerRef]);

	return (event, onLanded) =>
	{
		const trigger = event.currentTarget;
		const load: PendingLoad =
		{
			known: new Set(latestLoaded.current),
			mode: handoffMode(event),
			trigger,
			sawFetching: false,
			onLanded,
			landed: false,
		};
		pending.current = load;
		if (load.mode !== "ifDropped") return;
		const cancel = (pointer: PointerEvent) =>
		{
			if (pointer.target instanceof Node && trigger.contains(pointer.target)) return;
			if (pending.current === load) load.mode = null;
			document.removeEventListener("pointerdown", cancel, true);
		};
		document.addEventListener("pointerdown", cancel, true);
	};
}
