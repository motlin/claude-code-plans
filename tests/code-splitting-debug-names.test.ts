import {describe, expect, it} from "vite-plus/test";
import {nameCodeSplittingGroups} from "../src/lib/code-splitting-debug-names";

describe("nameCodeSplittingGroups", () => {
	it("labels each group whose name is a function and leaves named and already-labelled groups alone", () => {
		const libChunkName = (id: string) => id;
		const config = {
			output: {
				codeSplitting: {
					groups: [
						{test: /node_modules/, name: libChunkName},
						{test: /vendor/, name: "vendor"},
						{test: /other/, name: libChunkName, debugName: "other"},
					],
				},
			},
		};
		nameCodeSplittingGroups(config, "nitro-libs");
		expect(config).toStrictEqual({
			output: {
				codeSplitting: {
					groups: [
						{test: /node_modules/, name: libChunkName, debugName: "nitro-libs"},
						{test: /vendor/, name: "vendor"},
						{test: /other/, name: libChunkName, debugName: "other"},
					],
				},
			},
		});
	});

	it("ignores configs without code-splitting groups", () => {
		const config = {output: {codeSplitting: false}};
		nameCodeSplittingGroups(config, "nitro-libs");
		expect(config).toStrictEqual({output: {codeSplitting: false}});
	});
});
