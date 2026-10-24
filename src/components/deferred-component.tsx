import {
	Component,
	Suspense,
	use,
	useState,
	useSyncExternalStore,
	type ComponentType,
	type JSX,
	type ReactNode,
} from "react";

/** A module kept off the cold load: one cached download shared by its lazy boundaries and any idle or intent warm-ups. */
export interface DeferredModule<M> {
	preload: () => Promise<M>;
	loaded: () => M | undefined;
	/** Calls `listener` once the module arrives. */
	subscribe: (listener: () => void) => () => void;
}

export function deferredModule<M>(load: () => Promise<M>): DeferredModule<M> {
	let pending: Promise<M> | undefined;
	let module: M | undefined;
	const listeners = new Set<() => void>();
	return {
		// oxlint-disable-next-line typescript/promise-function-async -- returns the one cached download, which use() needs to be stable
		preload: () => {
			pending ??= load().then(
				(loaded) => {
					module = loaded;
					for (const listener of listeners) listener();
					return loaded;
				},
				(error: unknown) => {
					// A failed download is retried on the next show.
					pending = undefined;
					throw error;
				},
			);
			return pending;
		},
		loaded: () => module,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

/** Renders nothing once a child throws, so a failed chunk download hides its surface instead of the page. */
class HideOnError extends Component<{children: ReactNode}, {failed: boolean}> {
	override state = {failed: false};

	static getDerivedStateFromError(): {failed: boolean} {
		return {failed: true};
	}

	override render(): ReactNode {
		return this.state.failed ? null : this.props.children;
	}
}

// oxlint-disable-next-line typescript/no-explicit-any -- any function component, whatever its props
type FunctionComponentKeys<M> = {[K in keyof M]: M[K] extends (props: any) => unknown ? K : never}[keyof M];

type PropsOf<C> = C extends (props: infer P) => unknown ? P & object : never;

/**
 * `module[name]` behind a lazy boundary that renders nothing while the download runs (or if it fails). A client
 * instance mounted after the module arrived renders the component directly, like a static import.
 */
export function deferredComponent<M, K extends FunctionComponentKeys<M>>(
	module: DeferredModule<M>,
	name: K,
): (props: PropsOf<M[K]>) => JSX.Element {
	type Props = PropsOf<M[K]>;
	function Loader(props: Props) {
		// Always use(): skipping it once the promise settled would break React's rule for a render that suspended.
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- K is constrained to M's function components, whose props are Props
		const Component = use(module.preload())[name] as ComponentType<Props>;
		return <Component {...props} />;
	}
	return function Deferred(props: Props) {
		// The server always renders the boundary, so a hydrating client, which has not downloaded the chunk yet, matches it.
		const [Loaded] = useState(() =>
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- K is constrained to M's function components, whose props are Props
			import.meta.env.SSR ? undefined : (module.loaded()?.[name] as ComponentType<Props> | undefined),
		);
		if (Loaded !== undefined) return <Loaded {...props} />;
		return (
			<HideOnError>
				<Suspense fallback={null}>
					<Loader {...props} />
				</Suspense>
			</HideOnError>
		);
	};
}

const serverModule = () => undefined;

/**
 * The deferred module once it has arrived, re-rendering the caller when it does, so a hot path can render its
 * components directly instead of through a `deferredComponent` boundary.
 */
export function useLoadedModule<M>(module: DeferredModule<M>): M | undefined {
	return useSyncExternalStore(module.subscribe, module.loaded, serverModule);
}
