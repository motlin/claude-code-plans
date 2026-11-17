/**
 * Upstream `h6`/`g6`: each workflow task's last size warning or its dismissal, in memory only, so
 * it survives client navigation and is lost on reload.
 */
import type {SizeWarningEntry, SizeWarningStore} from "./workflow-size-warning";

let store: SizeWarningStore = new Map();
const listeners = new Set<() => void>();

export function getWorkflowSizeStore(): SizeWarningStore
{
	return store;
}

export function setWorkflowSizeStore(next: SizeWarningStore): void
{
	store = next;
	for (const listener of listeners) listener();
}

export function setWorkflowSizeEntry(taskId: string, entry: SizeWarningEntry): void
{
	setWorkflowSizeStore(new Map(store).set(taskId, entry));
}

export function subscribeWorkflowSizeStore(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

/** Test seam: forget every warning and dismissal. */
export function resetWorkflowSizeStore(): void
{
	setWorkflowSizeStore(new Map());
}
