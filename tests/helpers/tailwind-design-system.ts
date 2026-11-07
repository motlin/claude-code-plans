import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {__unstable__loadDesignSystem} from "tailwindcss";

const require = createRequire(import.meta.url);

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;

let cached: Promise<DesignSystem> | undefined;

/**
 * The project's Tailwind v4 design system, built from `src/styles/globals.css` with every import that
 * contributes utilities (`tailwindcss`, `tw-animate-css`, the relative sheets). Only the `@fontsource`
 * font-face imports are dropped. Memoised: the first call pays the ~0.2s load.
 */
export async function loadDesignSystem(): Promise<DesignSystem> {
	cached ??= load();
	return cached;
}

async function load(): Promise<DesignSystem> {
	const tailwindRoot = dirname(require.resolve("tailwindcss/package.json"));
	const animateCss = resolve("node_modules/tw-animate-css/dist/tw-animate.css");
	const css = readFileSync("src/styles/globals.css", "utf8").replaceAll(/^@import "@fontsource\/.*$/gm, "");
	return __unstable__loadDesignSystem(css, {
		base: resolve("src/styles"),
		loadStylesheet: async (id: string, base: string) => {
			const path =
				id === "tailwindcss"
					? join(tailwindRoot, "index.css")
					: id === "tw-animate-css"
						? animateCss
						: resolve(base, id);
			return Promise.resolve({path, base: dirname(path), content: readFileSync(path, "utf8")});
		},
	});
}

/** Each candidate's compiled CSS with whitespace collapsed, or `null` when it compiles to nothing. */
export async function compileAll(candidates: readonly string[]): Promise<Record<string, string | null>> {
	const rules = (await loadDesignSystem()).candidatesToCss([...candidates]);
	return Object.fromEntries(
		candidates.map((candidate, index) => [candidate, rules[index]?.replaceAll(/\s+/g, " ").trim() ?? null]),
	);
}
