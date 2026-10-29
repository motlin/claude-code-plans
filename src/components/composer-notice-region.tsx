import {
	createContext,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type AnimationEvent,
	type ReactNode,
	type RefObject,
} from "react";
import {NOTICE_ORDER, orderNotices, type Notice, type NoticeSlot, type OrderedNotice} from "../lib/composer-notices";

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

/** Upstream's exit (`PY` = cds-reveal-out); keyframes in globals.css, none under reduced motion. */
export const NOTICE_EXIT_CLASS = "notice-reveal-out";

/** Upstream `QU` drops every exiting notice 300ms after the exiting set last changed, if animationend never fired. */
const EXIT_HOLD_MS = 300;

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

interface RegionItem extends OrderedNotice<RegionEntry> {
	readonly exiting: boolean;
}

/** Merges notices still leaving into the live list, each at its slot's NOTICE_ORDER position. */
function mergeLeaving(
	live: OrderedNotice<RegionEntry>[],
	leaving: readonly OrderedNotice<RegionEntry>[],
): RegionItem[] {
	const items: RegionItem[] = [
		...live.map((item) => ({...item, exiting: false})),
		...leaving.map((item) => ({...item, exiting: true})),
	];
	const rank = (item: RegionItem) => NOTICE_ORDER.indexOf(item.slot) * 2 + (item.exiting ? 0 : 1);
	return items.toSorted((a, b) => rank(a) - rank(b));
}

/**
 * Upstream's region (`gce` + cds `ChatComposerNotices`): every registered notice stacked in
 * NOTICE_ORDER inside one polite status list. The wrapper's -mb-1.5 cancels the dock column's gap.
 * A withdrawn notice stays in place, inert, until its exit animation ends or 300ms pass (`QU`).
 */
export function ComposerNoticeRegion() {
	const registry = useContext(RegistryContext);
	const entries = useContext(EntriesContext);
	const listRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		registry?.setRegionMounted(true);
		return () => {
			registry?.setRegionMounted(false);
		};
	}, [registry]);

	const live = orderNotices(entries);
	// Derived during render (not in an effect) so a leaving item keeps its DOM node and focus.
	const [previousLive, setPreviousLive] = useState(live);
	const [leaving, setLeaving] = useState<readonly OrderedNotice<RegionEntry>[]>([]);
	let currentLeaving = leaving;
	if (previousLive.map(({key}) => key).join() !== live.map(({key}) => key).join()) {
		const liveKeys = new Set(live.map(({key}) => key));
		currentLeaving = [
			...leaving.filter(({key}) => !liveKeys.has(key)),
			...previousLive.filter(({key}) => !liveKeys.has(key) && !leaving.some((item) => item.key === key)),
		];
		setPreviousLive(live);
		setLeaving(currentLeaving);
	}

	const leavingKeys = currentLeaving.map(({key}) => key).join();
	useEffect(() => {
		if (leavingKeys === "") return undefined;
		const timer = setTimeout(() => {
			setLeaving([]);
		}, EXIT_HOLD_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [leavingKeys]);

	const onExited = (key: string) => {
		setLeaving((previous) => previous.filter((item) => item.key !== key));
	};

	return (
		<div data-cds-dock-group="" data-code-column-notices="" className="-mb-1.5">
			<div ref={listRef} data-cds="ChatComposerNotices" data-cds-dock-group="" tabIndex={-1} className="w-full">
				<div role="status" aria-live="polite" aria-atomic="false">
					<InRegionContext.Provider value>
						{mergeLeaving(live, currentLeaving).map((item) => (
							<NoticeItem key={item.key} item={item} listRef={listRef} onExited={onExited} />
						))}
					</InRegionContext.Provider>
				</div>
			</div>
		</div>
	);
}

function NoticeItem({
	item,
	listRef,
	onExited,
}: {
	item: RegionItem;
	listRef: RefObject<HTMLDivElement | null>;
	onExited: (key: string) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const {exiting, key, notice} = item;
	useLayoutEffect(() => {
		const element = ref.current;
		if (element === null) return;
		// Upstream `Vq`/`WY`: focus inside a leaving notice moves to the list root before it goes inert.
		if (exiting && element.contains(document.activeElement)) listRef.current?.focus();
		element.toggleAttribute("inert", exiting);
	}, [exiting, listRef]);
	const className = exiting
		? `pb-1 ${NOTICE_EXIT_CLASS} pointer-events-none`
		: notice.early
			? "pb-1"
			: `pb-1 ${NOTICE_ENTER_CLASS}`;
	return (
		<div
			ref={ref}
			className={className}
			aria-hidden={exiting || undefined}
			onAnimationEnd={
				exiting
					? (event: AnimationEvent<HTMLDivElement>) => {
							if (event.target === event.currentTarget) onExited(key);
						}
					: undefined
			}
		>
			{notice.content}
		</div>
	);
}
