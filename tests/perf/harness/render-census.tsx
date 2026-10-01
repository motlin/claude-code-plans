import {type ComponentType, Profiler, type ReactNode} from "react";

/**
 * Render census (measurement plan §2.4 L11): which components rendered in each step of an interaction, and how many
 * mounted components consume a context. It reads React's committed fiber tree the way React DevTools does, so no
 * component needs instrumenting. Components are keyed by display name; anonymous ones share "Anonymous".
 */

/** The fiber fields the census reads; React does not export the type. */
interface Fiber {
	tag: number;
	type: unknown;
	flags: number;
	child: Fiber | null;
	sibling: Fiber | null;
	alternate: Fiber | null;
	stateNode: unknown;
	dependencies: {firstContext: ContextDependency | null} | null;
}

interface ContextDependency {
	context: unknown;
	next: ContextDependency | null;
}

const FUNCTION_COMPONENT = 0;
const CLASS_COMPONENT = 1;
const CONTEXT_PROVIDER = 10;
const FORWARD_REF = 11;
const SIMPLE_MEMO_COMPONENT = 15;
const COMPONENT_TAGS = new Set([FUNCTION_COMPONENT, CLASS_COMPONENT, FORWARD_REF, SIMPLE_MEMO_COMPONENT]);
/** Set on a fiber that called its render function in this commit; a bailout leaves it clear. */
const PERFORMED_WORK = 1;

const CONTAINER_KEY_PREFIX = "__reactContainer$";

function componentName(fiber: Fiber): string {
	const type = (fiber.tag === FORWARD_REF ? (fiber.type as {render: unknown}).render : fiber.type) as {
		displayName?: string;
		name?: string;
	};
	return type.displayName ?? (type.name || "Anonymous");
}

function* children(fiber: Fiber): Generator<Fiber> {
	for (let child = fiber.child; child !== null; child = child.sibling) {
		yield child;
	}
}

/** The current HostRoot fiber of every React root rendered into `document.body`. */
function hostRoots(): Fiber[] {
	const roots: Fiber[] = [];
	for (const element of document.body.children) {
		const key = Object.keys(element).find((name) => name.startsWith(CONTAINER_KEY_PREFIX));
		if (key !== undefined) {
			const container = (element as unknown as Record<string, Fiber>)[key]!;
			roots.push((container.stateNode as {current: Fiber}).current);
		}
	}
	return roots;
}

function* allFibers(fiber: Fiber): Generator<Fiber> {
	yield fiber;
	for (const child of children(fiber)) {
		yield* allFibers(child);
	}
}

export interface RenderCensus {
	/** Wrap the measured tree in this; it reads every commit while a step is recording. */
	Root: ComponentType<{children: ReactNode}>;
	/** Starts recording a new step; renders until the next `startStep` or `stop` count toward it. */
	startStep: () => void;
	stop: () => void;
	/** Per step, how many times each component rendered, keyed by name in sorted order. */
	steps: () => Array<Record<string, number>>;
	/** Mounted components that read the context the given provider component renders. */
	contextConsumers: (provider: ComponentType<never>) => number;
}

export function createRenderCensus(): RenderCensus {
	const steps: Array<Map<string, number>> = [];
	let recording = false;

	const record = (fiber: Fiber) => {
		const step = steps.at(-1)!;
		const name = componentName(fiber);
		step.set(name, (step.get(name) ?? 0) + 1);
	};

	const recordMount = (fiber: Fiber) => {
		for (const each of allFibers(fiber)) {
			if (COMPONENT_TAGS.has(each.tag)) record(each);
		}
	};

	// React DevTools' walk: a subtree whose child pointer did not change was not visited in this commit.
	const recordUpdate = (next: Fiber, previous: Fiber) => {
		if (COMPONENT_TAGS.has(next.tag) && (next.flags & PERFORMED_WORK) !== 0) record(next);
		if (next.child === previous.child) return;
		for (const child of children(next)) {
			if (child.alternate === null) recordMount(child);
			else recordUpdate(child, child.alternate);
		}
	};

	const onCommit = () => {
		if (!recording) return;
		for (const root of hostRoots()) {
			if (root.alternate === null) recordMount(root);
			else recordUpdate(root, root.alternate);
		}
	};

	function Root({children: tree}: {children: ReactNode}) {
		return (
			<Profiler id="render-census" onRender={onCommit}>
				{tree}
			</Profiler>
		);
	}

	return {
		Root,
		startStep: () => {
			steps.push(new Map());
			recording = true;
		},
		stop: () => {
			recording = false;
		},
		steps: () =>
			steps.map((step) => Object.fromEntries([...step].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))),
		contextConsumers: (provider) => {
			const fibers = hostRoots().flatMap((root) => [...allFibers(root)]);
			const providerFiber = fibers.find((fiber) => fiber.type === provider);
			const contextFiber =
				providerFiber === undefined
					? undefined
					: [...allFibers(providerFiber)].find((fiber) => fiber.tag === CONTEXT_PROVIDER);
			if (contextFiber === undefined) throw new Error("render census: the provider renders no context");
			const context = contextFiber.type;
			return fibers.filter((fiber) => {
				for (let dependency = fiber.dependencies?.firstContext ?? null; dependency !== null;) {
					if (dependency.context === context) return true;
					dependency = dependency.next;
				}
				return false;
			}).length;
		},
	};
}
