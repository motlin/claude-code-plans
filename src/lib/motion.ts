/** True under the OS reduced-motion setting or Settings ▸ Motion ▸ Reduced (`html[data-motion=reduced]`). */
export function motionReduced(): boolean {
	if (document.documentElement.dataset["motion"] === "reduced") return true;
	return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
