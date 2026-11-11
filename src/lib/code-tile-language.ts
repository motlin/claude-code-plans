import {bundledLanguages} from "shiki";

/** Upstream c476e9be4 `h`: language aliases. */
const LANGUAGE_ALIASES: Record<string, string> = {
	cmd: "bat",
	env: "dotenv",
	fortran: "fortran-free-form",
	golang: "go",
	patch: "diff",
	pwsh: "powershell",
	svg: "xml",
	systemverilog: "system-verilog",
	txt: "text",
	vba: "vb",
	vbnet: "vb",
};

/** Upstream c476e9be4 `g`: plain-text languages every highlighter draws. */
const PLAIN_LANGUAGES = new Set(["text", "ansi"]);

/**
 * Upstream c476e9be4 `D`: trimmed and lowercased (empty → text), aliased, and plain text for a language the
 * highlighter does not bundle.
 */
export function tileLanguage(lang: string): string {
	const trimmed = lang.trim().toLowerCase() || "text";
	const aliased = LANGUAGE_ALIASES[trimmed] ?? trimmed;
	return PLAIN_LANGUAGES.has(aliased) || aliased in bundledLanguages ? aliased : "text";
}
