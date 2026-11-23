import {createContext, type ReactNode, use, useCallback, useEffect, useId, useMemo, useRef, useState} from "react";

import {setSidebarMenuOpen} from "../../lib/sidebar-menu-open";
import {Menu} from "../ui/menu";
import {createMenuHandle, type MenuHandle} from "../ui/menu-handle";
import {GroupSortTrigger} from "./section-view-menu";
import {freezeAnchor, type FrozenAnchor} from "./frozen-anchor";
import {SidebarHiddenContext} from "./sidebar-hidden";

/** Upstream `LJ`. */
interface HostState
{
	open: boolean;
	triggerId: string | null;
	anchor: FrozenAnchor | null;
	held: boolean;
}

const CLOSED: HostState =
{
	open: false,
	triggerId: null,
	anchor: null,
	held: false,
};

/** The open menu's bookkeeping, outside React state so an unmount cleanup sees it at once. */
interface OpenRecord
{
	triggerId: string;
	anchor: FrozenAnchor;
	/** The list the triggers live in, for the nearest-trigger scan and the focus rescue. */
	list: Element | null;
	closing: boolean;
	fromInside: boolean;
	refocus: HTMLElement | null;
}

/** Upstream `PB`: the laid-out Group and sort trigger whose top is nearest the frozen one. */
function nearestTrigger(list: Element | null, top: number): string | null
{
	let nearest: string | null = null;
	let best = Infinity;
	for (const span of list?.querySelectorAll("[data-group-sort-trigger]") ?? [])
	{
		const id = span.getAttribute("data-group-sort-trigger");
		const rect = id === null ? undefined : span.ownerDocument.getElementById(id)?.getBoundingClientRect();
		if (rect === undefined || rect.height <= 0 || Math.abs(rect.top - top) >= best) continue;
		best = Math.abs(rect.top - top);
		nearest = id;
	}
	return nearest;
}

/** Upstream `u_`: when focus was lost or sat in the menu, move it to the nearest trigger, a group toggle, or any control. */
function rescueFocus(list: Element | null, nearest: string | null)
{
	if (list === null) return;
	const doc = list.ownerDocument;
	const active = doc.activeElement;
	if (active !== null && active !== doc.body && active.closest('[role="menu"]') === null) return;
	const target =
		(nearest === null ? null : doc.getElementById(nearest)) ??
		list.querySelector<HTMLElement>("[data-group-toggle]") ??
		list.querySelector<HTMLElement>("button:not([disabled]), a[href]");
	target?.focus();
}

/** Upstream `qs`: the list can't scroll out from under the frozen popup; pinch zoom and the menu itself still can. */
function blockWheel(event: WheelEvent)
{
	if (event.ctrlKey) return;
	if (event.target instanceof Element && event.target.closest('[role="menu"]') !== null) return;
	event.preventDefault();
}

interface GroupSortMenuShared
{
	handle: MenuHandle<unknown>;
	openTriggerId: string | null;
	held: boolean;
	onTriggerGone: (id: string) => void;
}

const GroupSortMenuContext = createContext<GroupSortMenuShared | null>(null);

/**
 * Upstream `Md`: one Group and sort menu for the whole session list, opened from any section header's detached
 * trigger. When the open trigger's header unmounts (a regroup, a Show toggle, a live update emptying its section),
 * the menu stays open at its frozen rect and holds on the nearest surviving trigger; with none left it closes and
 * rescues focus. It also blocks list wheel scrolling while open and closes when the sidebar hides around it.
 */
export function GroupSortMenuHost({
	children,
	renderMenu,
}: {
	children: ReactNode;
	/** The popup, given the frozen anchor to pin to and whether focus returns to the trigger on close. */
	renderMenu: (anchor: FrozenAnchor | undefined) => ReactNode;
})
{
	const [handle] = useState(() => createMenuHandle<unknown>());
	const [state, setState] = useState<HostState>(CLOSED);
	const {open, triggerId, anchor, held} = state;
	const record = useRef<OpenRecord | null>(null);

	const change = useCallback(
		(
			nextOpen: boolean,
			details?:
			{
				trigger?: Element | undefined;
				reason?: string;
			},
		) =>
		{
			const trigger = details?.trigger;
			if (nextOpen)
			{
				record.current =
					trigger === undefined
						? null
						:
							{
								triggerId: trigger.id,
								anchor: freezeAnchor(trigger),
								list: trigger.closest("[data-recents-list]"),
								closing: false,
								fromInside: false,
								refocus: null,
							};
			}
			else if (record.current !== null)
			{
				record.current.closing = true;
				record.current.fromInside = details?.reason === "escape-key" || details?.reason === "item-press";
			}
			const current = record.current;
			setState((previous) =>
			{
				if (nextOpen)
				{
					return {
						open: true,
						triggerId: current?.triggerId ?? null,
						anchor: current?.anchor ?? null,
						held: false,
					};
				}
				return previous.open
					?
						{
							...previous,
							open: false,
						}
					: previous;
			});
			// Upstream `f(open, true)`: the only caller that flags the open menu as Group and sort.
			setSidebarMenuOpen(nextOpen, true);
		},
		[],
	);

	// Upstream's open/close effect: refocus the menu item after a re-anchor, or scroll a held trigger into view once
	// an inside close (Escape, item press) has returned keyboard focus to it.
	useEffect(() =>
	{
		const current = record.current;
		if (!open)
		{
			if (current?.closing !== true) return undefined;
			record.current = null;
			const target = held && current.fromInside ? document.getElementById(current.triggerId) : null;
			if (target === null) return undefined;
			const onFocus = () =>
			{
				if (target.matches(":focus-visible"))
				{
					target.closest("[data-group-sort-trigger]")?.scrollIntoView(
						{
							block: "nearest",
						},
					);
				}
			};
			target.addEventListener(
				"focus",
				onFocus,
				{
					once: true,
				},
			);
			return () =>
			{
				target.removeEventListener("focus", onFocus);
			};
		}
		const refocus = current?.refocus;
		if (current === null || refocus === null || refocus === undefined) return undefined;
		current.refocus = null;
		requestAnimationFrame(() =>
		{
			if (record.current === current && !current.closing)
			{
				refocus.focus(
					{
						preventScroll: true,
					},
				);
			}
		});
		return undefined;
	}, [open, triggerId, held]);

	useEffect(() =>
	{
		if (!open || anchor === null) return undefined;
		const doc = anchor.contextElement.ownerDocument;
		doc.addEventListener(
			"wheel",
			blockWheel,
			{
				passive: false,
			},
		);
		return () =>
		{
			doc.removeEventListener("wheel", blockWheel);
		};
	}, [open, anchor]);

	const onTriggerGone = useCallback(
		(id: string) =>
		{
			const clearStale = () =>
			{
				setState((previous) =>
					!previous.open && previous.triggerId === id
						?
							{
								...previous,
								triggerId: null,
							}
						: previous,
				);
			};
			const current = record.current;
			if (current?.triggerId !== id)
			{
				clearStale();
				return;
			}
			const nearest = nearestTrigger(current.list, current.anchor.getBoundingClientRect().top);
			if (nearest === null || current.closing)
			{
				record.current = null;
				if (!current.closing) change(false);
				clearStale();
				rescueFocus(current.list, nearest);
				return;
			}
			current.triggerId = nearest;
			const active = current.list?.ownerDocument.activeElement;
			current.refocus = active?.closest<HTMLElement>("[role^=menuitem]") ?? null;
			setState((previous) => (
			{
				...previous,
				triggerId: nearest,
				held: true,
			}));
		},
		[change],
	);

	// Upstream `wW`: close on the rising edge of the sidebar hiding, never because it opened while hidden.
	const sidebarHidden = use(SidebarHiddenContext);
	const wasHidden = useRef(sidebarHidden);
	useEffect(() =>
	{
		if (sidebarHidden && !wasHidden.current) change(false);
		wasHidden.current = sidebarHidden;
	}, [sidebarHidden, change]);

	const openTriggerId = open ? triggerId : null;
	const shared = useMemo<GroupSortMenuShared>(
		() => (
		{
			handle,
			openTriggerId,
			held,
			onTriggerGone,
		}),
		[handle, openTriggerId, held, onTriggerGone],
	);
	return (
		<GroupSortMenuContext value={shared}>
			{children}
			<Menu handle={handle} open={open} triggerId={triggerId} onOpenChange={change}>
				{renderMenu(anchor ?? undefined)}
			</Menu>
		</GroupSortMenuContext>
	);
}

/**
 * Upstream `Cs`: a section header's Group and sort trigger for the host's shared menu, in a span naming the
 * trigger's id so the host can find the nearest one, with an 8px scroll margin for the scroll-into-view after a
 * held close.
 */
export function GroupSortTriggerSlot()
{
	const shared = use(GroupSortMenuContext);
	const id = useId();
	const onTriggerGone = shared?.onTriggerGone;
	useEffect(
		() => () =>
		{
			onTriggerGone?.(id);
		},
		[onTriggerGone, id],
	);
	if (shared === null) return null;
	const open = shared.openTriggerId === id;
	return (
		// Upstream's hub sidebar keeps the slot at `flex` (`o_(open && !held, inHubSidebar)`); CSS fades it by opacity.
		<span
			data-group-sort-trigger={id}
			className="flex"
			style={
			{
				scrollMarginBlock: 8,
			}}
		>
			<GroupSortTrigger handle={shared.handle} id={id} open={open} held={open && shared.held} />
		</span>
	);
}
