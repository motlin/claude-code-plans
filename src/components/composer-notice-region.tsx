import {createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from "react";
import {orderNotices, type Notice, type NoticeSlot} from "../lib/composer-notices";

/** A band's descriptor for the region: its id (keying the item) and what it draws. */
export interface ComposerNotice extends Notice {
	readonly content: ReactNode;
}

interface RegionEntry extends Notice {
	readonly content: ReactNode;
	/** Registered before the region mounted, so it shows without the reveal (upstream's `early` → `skipEnter`). */
	readonly early: boolean;
}

interface Registry {
	register: (slot: NoticeSlot, notice: ComposerNotice) => void;
	unregister: (slot: NoticeSlot) => void;
	setRegionMounted: (mounted: boolean) => void;
}

// The registry API and the entries live in separate contexts, so a registering band does not
// re-render (and re-register) whenever the entries change.
const RegistryContext = createContext<Registry | null>(null);
const EntriesContext = createContext<ReadonlyMap<NoticeSlot, RegionEntry>>(new Map());
// True inside a region item: the region's list is the live region, so a band drops its own.
const InRegionContext = createContext(false);

/** Whether this band draws inside the region's polite status list rather than as its own live band. */
export function useInNoticeRegion(): boolean {
	return useContext(InRegionContext);
}

/** Upstream cds-reveal-in at --cds-dur-base (.2s) with --cds-ease-out, motion-safe only. */
export const NOTICE_ENTER_CLASS = "motion-safe:animate-[reveal-in_200ms_cubic-bezier(.165,.84,.44,1)_both]";

/**
 * Upstream's notice provider (`hn`): bands under it register descriptors by slot instead of
 * rendering inline, and the region stacks them.
 */
export function ComposerNoticeProvider({children}: {children?: ReactNode}) {
	const [entries, setEntries] = useState<ReadonlyMap<NoticeSlot, RegionEntry>>(new Map());
	const regionMounted = useRef(false);
	const registry = useMemo<Registry>(
		() => ({
			register: (slot, notice) => {
				setEntries((previous) => {
					const existing = previous.get(slot);
					// A re-registration of the same notice keeps its enter decision, so it doesn't replay the reveal.
					const early =
						existing !== undefined && existing.id === notice.id ? existing.early : !regionMounted.current;
					return new Map(previous).set(slot, {id: notice.id, content: notice.content, early});
				});
			},
			unregister: (slot) => {
				setEntries((previous) => {
					if (!previous.has(slot)) return previous;
					const next = new Map(previous);
					next.delete(slot);
					return next;
				});
			},
			setRegionMounted: (mounted) => {
				regionMounted.current = mounted;
			},
		}),
		[],
	);
	return (
		<RegistryContext.Provider value={registry}>
			<EntriesContext.Provider value={entries}>{children}</EntriesContext.Provider>
		</RegistryContext.Provider>
	);
}

/**
 * Upstream's `_n(slot, notice)`: under a provider, registers the band's notice (null withdraws it)
 * and returns true so the band renders nothing inline; with no provider it returns false and the
 * band draws its own legacy markup in place.
 */
export function useComposerNotice(slot: NoticeSlot, notice: ComposerNotice | null): boolean {
	const registry = useContext(RegistryContext);
	useLayoutEffect(() => {
		if (registry === null) return;
		if (notice === null) registry.unregister(slot);
		else registry.register(slot, notice);
	});
	useLayoutEffect(
		() =>
			registry === null
				? undefined
				: () => {
						registry.unregister(slot);
					},
		[registry, slot],
	);
	return registry !== null;
}

/**
 * Upstream's region (`gce` + cds `ChatComposerNotices`): every registered notice stacked in
 * NOTICE_ORDER inside one polite status list. The wrapper's -mb-1.5 cancels the dock column's gap.
 */
export function ComposerNoticeRegion() {
	const registry = useContext(RegistryContext);
	const entries = useContext(EntriesContext);
	useLayoutEffect(() => {
		registry?.setRegionMounted(true);
		return () => {
			registry?.setRegionMounted(false);
		};
	}, [registry]);
	return (
		<div data-cds-dock-group="" data-code-column-notices="" className="-mb-1.5">
			<div data-cds="ChatComposerNotices" data-cds-dock-group="" tabIndex={-1} className="w-full">
				<div role="status" aria-live="polite" aria-atomic="false">
					<InRegionContext.Provider value>
						{orderNotices(entries).map(({key, notice}) => (
							<div key={key} className={notice.early ? "pb-1" : `pb-1 ${NOTICE_ENTER_CLASS}`}>
								{notice.content}
							</div>
						))}
					</InRegionContext.Provider>
				</div>
			</div>
		</div>
	);
}
