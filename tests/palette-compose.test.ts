import {describe, expect, it} from "vite-plus/test";
import {switchPaletteView} from "../src/lib/palette-compose";

describe("switchPaletteView", () => {
	it("ports upstream's carry-over: the leaving text moves only into an empty buffer, and multi-line text never into Search", () => {
		expect([
			switchPaletteView("compose", {search: "foo", compose: ""}),
			switchPaletteView("search", {search: "", compose: "foo"}),
			switchPaletteView("search", {search: "", compose: "a\nb"}),
			switchPaletteView("compose", {search: "", compose: "a\nb"}),
			switchPaletteView("compose", {search: "a\nb", compose: ""}),
			switchPaletteView("search", {search: "b", compose: "a"}),
			switchPaletteView("compose", {search: "b", compose: "a"}),
			switchPaletteView("compose", {search: "foo", compose: "   "}),
			switchPaletteView("search", {search: "  ", compose: "foo"}),
			switchPaletteView("compose", {search: "", compose: ""}),
		]).toStrictEqual([
			{search: "", compose: "foo"},
			{search: "foo", compose: ""},
			{search: "", compose: "a\nb"},
			{search: "", compose: "a\nb"},
			{search: "", compose: "a\nb"},
			{search: "b", compose: "a"},
			{search: "b", compose: "a"},
			{search: "", compose: "foo"},
			{search: "foo", compose: ""},
			{search: "", compose: ""},
		]);
	});
});
