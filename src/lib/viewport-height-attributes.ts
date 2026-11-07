// Mirrors upstream's boot installer (shared-l-p-m-w-5 J6): while the viewport is at
// most N px tall, <body> carries data-vh-max-N, which the vh-max-N: variants read.
export const VIEWPORT_HEIGHT_STEPS = [400, 420, 520] as const;

const installed = new WeakSet<Document>();

export function installViewportHeightAttributes(doc: Document = document): void {
	const view = doc.defaultView;
	// lib.dom types body as non-null, but it is null until the parser reaches <body>.
	const body = doc.body as HTMLElement | null;
	if (installed.has(doc) || typeof view?.matchMedia !== "function" || body === null) return;
	installed.add(doc);
	for (const step of VIEWPORT_HEIGHT_STEPS) {
		const query = view.matchMedia(`(max-height: ${step}px)`);
		const apply = () => {
			body.toggleAttribute(`data-vh-max-${step}`, query.matches);
		};
		apply();
		query.addEventListener("change", apply);
	}
}
