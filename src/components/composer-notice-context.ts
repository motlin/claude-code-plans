import {createContext, type ReactNode, useContext, useLayoutEffect} from "react";

import type {Notice, NoticeSlot} from "../lib/composer-notices";

/** A band's descriptor for the region: its id (keying the item) and what it draws. */
export interface ComposerNotice extends Notice
{
	readonly content: ReactNode;
}

export interface RegionEntry extends Notice
{
	readonly content: ReactNode;
	/** Registered before the region mounted, so it shows without the reveal (upstream's `early` → `skipEnter`). */
	readonly early: boolean;
}

export interface Registry
{
	register: (slot: NoticeSlot, notice: ComposerNotice) => void;
	unregister: (slot: NoticeSlot) => void;
	setRegionMounted: (mounted: boolean) => void;
}

// The registry API and the entries live in separate contexts, so a registering band does not
// re-render (and re-register) whenever the entries change.
export const RegistryContext = createContext<Registry | null>(null);
export const EntriesContext = createContext<ReadonlyMap<NoticeSlot, RegionEntry>>(new Map());
// True inside a region item: the region's list is the live region, so a band drops its own.
export const InRegionContext = createContext(false);

/** Whether this band draws inside the region's polite status list rather than as its own live band. */
export function useInNoticeRegion(): boolean
{
	return useContext(InRegionContext);
}

/**
 * Upstream's `_n(slot, notice)`: under a provider, registers the band's notice (null withdraws it)
 * and returns true so the band renders nothing inline; with no provider it returns false and the
 * band draws its own legacy markup in place.
 */
export function useComposerNotice(slot: NoticeSlot, notice: ComposerNotice | null): boolean
{
	const registry = useContext(RegistryContext);
	useLayoutEffect(() =>
	{
		if (registry === null) return;
		if (notice === null) registry.unregister(slot);
		else registry.register(slot, notice);
	});
	useLayoutEffect(
		() =>
			registry === null
				? undefined
				: () =>
					{
						registry.unregister(slot);
					},
		[registry, slot],
	);
	return registry !== null;
}
