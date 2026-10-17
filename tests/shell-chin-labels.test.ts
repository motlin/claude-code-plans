import {afterEach, describe, expect, it} from "vite-plus/test";
import {withShellChinLabels} from "../src/lib/shell-chin-labels";
import {getShellChinLabels, setShellChinLabels} from "../src/lib/shell-chin-store";

const settings = {model: "opus", effortLevel: "medium", permissions: {defaultMode: "auto"}};

async function labelsAfter(url: string, method = "GET") {
	let seen: ReturnType<typeof getShellChinLabels> = null;
	const fetch = withShellChinLabels(
		() => {
			seen = getShellChinLabels();
			return new Response("ok");
		},
		async () => Promise.resolve(settings),
	);
	await fetch(new Request(url, {method}));
	return seen;
}

describe("withShellChinLabels", () => {
	afterEach(() => {
		setShellChinLabels(null);
	});

	it("reads settings.json before a page render so the shell paints its chin labels", async () => {
		expect(await labelsAfter("http://localhost/session/abc")).toStrictEqual({
			mode: "Auto",
			model: "Opus 5.5",
			effort: "Medium",
		});
	});

	it("skips API requests, which never render the shell", async () => {
		expect([
			await labelsAfter("http://localhost/api/sessions"),
			await labelsAfter("http://localhost/", "POST"),
		]).toStrictEqual([null, null]);
	});
});
