const STOP_NAME = "data-question-stop-name";
const FALLBACK_NAME = "data-fallback-name";
/** Upstream's `Oh`: an element already named, so the landing leaves its name alone. */
const ALREADY_NAMED = `[aria-labelledby], [aria-label]:not([${FALLBACK_NAME}])`;
/** Upstream's `_8`: a fallback name the landing's cleanup restores. */
const FALLBACK_NAMED = `[${FALLBACK_NAME}]:not([aria-label])`;

let namedByText = 0;

/**
 * Upstream's `nO`/`k0`: names an unnamed landed element by its `[data-question-stop-name]` parts (or by its own
 * text without any), as a group labelled by their ids. Returns the cleanup that restores what it changed.
 */
export function nameStopByText(element: Element): () => void
{
	if (element.matches(ALREADY_NAMED)) return () => undefined;
	const parts = [...element.querySelectorAll(`[${STOP_NAME}]`)].filter((part) => part.textContent.trim() !== "");
	const label = element.getAttribute("aria-label");
	const names = parts.length === 0 ? [element] : parts;
	const given = names.filter((part) => part.id === "");
	for (const part of given)
	{
		namedByText += 1;
		part.id = `named-by-text-${namedByText}`;
	}
	const addedRole = !element.hasAttribute("role");
	if (addedRole) element.setAttribute("role", "group");
	element.removeAttribute("aria-label");
	const labelledBy = names.map((part) => part.id).join(" ");
	element.setAttribute("aria-labelledby", labelledBy);
	return () =>
	{
		if (element.getAttribute("aria-labelledby") === labelledBy) element.removeAttribute("aria-labelledby");
		if (label !== null && element.matches(FALLBACK_NAMED)) element.setAttribute("aria-label", label);
		if (addedRole) element.removeAttribute("role");
		for (const part of given) part.removeAttribute("id");
	};
}
