import {describe, expect, it} from "vite-plus/test";
import {quietDependencyDirectives} from "../src/lib/build-log-filter";

const USE_CLIENT_IN_DEPENDENCY = {
	code: "MODULE_LEVEL_DIRECTIVE",
	id: "/repo/node_modules/.pnpm/@tanstack+react-router@1.0.0/node_modules/@tanstack/react-router/dist/esm/index.js",
	message:
		'The semantics of the module level directive "use client" in "node_modules/.pnpm/@tanstack+react-router@1.0.0/node_modules/@tanstack/react-router/dist/esm/index.js" may not be preserved',
};

describe("quietDependencyDirectives", () => {
	it("drops a dependency's 'use client' directive warning and forwards every other log", () => {
		const forwarded: unknown[] = [];
		const handler = (level: string, log: unknown) => forwarded.push([level, log]);
		const ownDirective = {...USE_CLIENT_IN_DEPENDENCY, id: "/repo/src/components/example.tsx"};
		const useServer = {
			...USE_CLIENT_IN_DEPENDENCY,
			message: USE_CLIENT_IN_DEPENDENCY.message.replace("use client", "use server"),
		};
		const other = {code: "CIRCULAR_DEPENDENCY", message: "Circular dependency: a -> b -> a"};

		quietDependencyDirectives("warn", USE_CLIENT_IN_DEPENDENCY, handler);
		quietDependencyDirectives("warn", ownDirective, handler);
		quietDependencyDirectives("warn", useServer, handler);
		quietDependencyDirectives("warn", other, handler);
		quietDependencyDirectives("info", {message: "transforming..."}, handler);

		expect(forwarded).toStrictEqual([
			["warn", ownDirective],
			["warn", useServer],
			["warn", other],
			["info", {message: "transforming..."}],
		]);
	});
});
