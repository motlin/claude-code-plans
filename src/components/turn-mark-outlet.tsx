import {
	createContext,
	useContext,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
	type RefObject,
} from "react";
import {createPortal} from "react-dom";

import {moveInto, TurnMarkOutletStore, type OpenOutlet} from "../lib/turn-mark-outlet";

const TurnMarkOutletContext = createContext<TurnMarkOutletStore | null>(null);

const noSubscribe = () => () => {};
const noOutlet = () => null;
const notUnderPlan = () => false;
const noOwner = () => undefined;

/** Upstream `tf`: one turn-mark store per session, with any pending late-close notice cancelled on unmount. */
export function TurnMarkOutletProvider({sessionId, children}: {sessionId: string; children: ReactNode}) {
	// oxlint-disable-next-line react-hooks/exhaustive-deps -- a new session gets a fresh store
	const store: TurnMarkOutletStore = useMemo(() => new TurnMarkOutletStore(), [sessionId]);
	useEffect(
		() => () => {
			store.cancelPendingClose();
		},
		[store],
	);
	return <TurnMarkOutletContext.Provider value={store}>{children}</TurnMarkOutletContext.Provider>;
}

/** Upstream `hf`: the element below a docked card (or plan box) that marked rows are carried into. */
export function TurnMarkOutlet({className, underPlan = false}: {className?: string; underPlan?: boolean}) {
	const store = useContext(TurnMarkOutletContext);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		store?.setOutletUnderPlan(underPlan);
	}, [store, underPlan]);
	useEffect(() => {
		const el = ref.current;
		if (store === null || el === null) return undefined;
		store.openOutlet(el);
		return () => {
			store.closeOutlet(el);
		};
	}, [store]);
	return (
		<div
			data-turn-mark-outlet=""
			data-transcript-last-row-controls=""
			ref={ref}
			className={
				className === undefined
					? "[&>[data-turn-mark-box]>*]:!my-0"
					: `[&>[data-turn-mark-box]>*]:!my-0 ${className}`
			}
		/>
	);
}

/** Upstream `bf`: keep the box in the open outlet while it is connected, else at home. */
function BoxPlacer({
	box,
	outlet,
	homeRef,
}: {
	box: HTMLElement;
	outlet: OpenOutlet | null;
	homeRef: RefObject<HTMLDivElement | null>;
}) {
	useLayoutEffect(() => {
		const parent = (outlet?.el.isConnected === true ? outlet.el : null) ?? homeRef.current;
		if (parent !== null) moveInto(box, parent);
	}, [box, outlet, homeRef]);
	return null;
}

/**
 * Upstream `xf`: while `holds`, carry the row's DOM into the open outlet through a portal, so its React state stays with
 * the row. Under a card every holder is carried; under a plan only the newest in-flight claimer is.
 */
export function TurnMarkCarrier({
	holds,
	inFlight = true,
	children,
}: {
	holds: boolean;
	inFlight?: boolean;
	children: ReactNode;
}): ReactNode {
	const store = useContext(TurnMarkOutletContext);
	const id = useId();
	const [box, setBox] = useState<HTMLElement | null>(null);
	const active = store !== null && holds;
	const outlet = useSyncExternalStore(
		active ? store.subscribeOutlet : noSubscribe,
		active ? store.outlet : noOutlet,
		noOutlet,
	);
	const underPlan = useSyncExternalStore(
		active ? store.subscribeOutlet : noSubscribe,
		active ? store.outletUnderPlan : notUnderPlan,
		notUnderPlan,
	);
	const claims = active && outlet !== null && underPlan && inFlight;
	useEffect(() => (claims ? store.claimOutlet(id) : undefined), [claims, store, id]);
	const owner = useSyncExternalStore(
		claims ? store.subscribeOutlet : noSubscribe,
		claims ? store.outletOwner : noOwner,
		noOwner,
	);
	const target = active && (!underPlan || (claims && (owner === undefined || owner === id))) ? outlet : null;
	const homeRef = useRef<HTMLDivElement>(null);
	if (box === null && target !== null) {
		const created = target.el.ownerDocument.createElement("div");
		created.className = "contents";
		created.setAttribute("data-turn-mark-box", id);
		created.setAttribute("data-find-omitted", "");
		setBox(created);
	}
	useEffect(() => {
		if (box === null) return undefined;
		const release = store?.carry(box, () => homeRef.current);
		return () => {
			release?.();
			box.remove();
		};
	}, [store, box]);
	if (box === null) return children;
	return (
		<>
			<div ref={homeRef} data-turn-mark-home={id} className="contents" />
			{createPortal(
				<>
					<BoxPlacer box={box} outlet={target} homeRef={homeRef} />
					{children}
				</>,
				box,
			)}
		</>
	);
}
