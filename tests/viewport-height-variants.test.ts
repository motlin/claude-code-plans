import {describe, expect, it} from "vite-plus/test";
import {loadDesignSystem} from "./helpers/tailwind-design-system";

async function compile(candidate: string): Promise<string> {
	const [rule] = (await loadDesignSystem()).candidatesToCss([candidate]);
	return (rule ?? "").replaceAll(/\s+/g, " ").trim();
}

describe("vh-max-400: / vh-max-420: / vh-max-520: read upstream's body[data-vh-max-N] attributes", () => {
	it("compiles vh-max-420: to a zero-specificity :where(body[data-vh-max-420]) ancestor, as upstream's stylesheet does", async () => {
		expect(await compile("vh-max-420:overflow-y-auto")).toBe(
			":where(body[data-vh-max-420]) .vh-max-420\\:overflow-y-auto { overflow-y: auto; }",
		);
	});

	it("compiles vh-max-400: the same way", async () => {
		expect(await compile("vh-max-400:shrink-0")).toBe(
			":where(body[data-vh-max-400]) .vh-max-400\\:shrink-0 { flex-shrink: 0; }",
		);
	});

	it("wraps max-sm:vh-max-520: in the below-sm media query", async () => {
		expect(await compile("max-sm:vh-max-520:flex-none")).toBe(
			"@media (width < 40rem) { :where(body[data-vh-max-520]) .max-sm\\:vh-max-520\\:flex-none { flex: none; } }",
		);
	});
});
