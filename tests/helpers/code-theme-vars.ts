/** Each custom property an element's inline style sets. */
export function customProperties(element: HTMLElement): Record<string, string>
{
	const names = Array.from(element.style).filter((name) => name.startsWith("--"));
	return Object.fromEntries(names.map((name) => [name, element.style.getPropertyValue(name)]));
}

/** Upstream c6e73333a `v` for the default claude-light / claude-dark pair. */
export const DEFAULT_CODE_THEME_VARS =
{
	"--code-theme-light-bg": "#ffffff",
	"--code-theme-dark-bg": "#191919",
	"--code-theme-light-git-modified": "#895503",
	"--code-theme-light-git-untracked": "#007100",
	"--code-theme-light-git-added": "#587c0c",
	"--code-theme-light-git-renamed": "#007100",
	"--code-theme-light-git-conflict": "#ad0707",
	"--code-theme-dark-git-modified": "#e2c08d",
	"--code-theme-dark-git-untracked": "#73c991",
	"--code-theme-dark-git-added": "#81b88b",
	"--code-theme-dark-git-renamed": "#73c991",
	"--code-theme-dark-git-conflict": "#f48771",
	"--code-theme-bg": "light-dark(#ffffff, #191919)",
	"--code-theme-light-selection-bg": "#0073e640",
	"--code-theme-dark-selection-bg": "#0099ff4d",
	"--cds-code-text-selection-bg": "light-dark(#0073e640, #0099ff4d)",
	"--code-theme-selection-match-bg": "light-dark(#0073e61a, #0099ff24)",
	"--code-theme-find-match-bg": "light-dark(#ffd5008c, #ffd5008c)",
	"--code-theme-find-match-fg": "light-dark(#000000, #000000)",
	"--code-theme-find-match-border":
		"light-dark(color-mix(in srgb, currentColor 60%, transparent), color-mix(in srgb, currentColor 60%, transparent))",
	"--code-theme-find-match-highlight-bg": "light-dark(#ffd50040, #ffd5002e)",
	"--code-theme-find-match-highlight-fg": "light-dark(#14181f, #eaecf0)",
	"--code-theme-find-match-highlight-border": "light-dark(transparent, transparent)",
};
