// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";
import {installPaletteFocusOrigin, paletteFocusOrigin} from "../src/lib/palette-focus-origin";

let uninstall: (() => void) | undefined;

afterEach(() =>
{
	uninstall?.();
	uninstall = undefined;
	document.body.innerHTML = "";
});

function setUp(html: string): void
{
	document.body.innerHTML = html;
	uninstall = installPaletteFocusOrigin(document);
}

function byId(id: string): HTMLElement
{
	const element = document.getElementById(id);
	if (element === null) throw new Error(`No #${id}`);
	return element;
}

describe("paletteFocusOrigin", () =>
{
	it("records the last element focused outside the palette", () =>
	{
		setUp(`<button id="x">X</button>`);
		byId("x").focus();
		expect(paletteFocusOrigin()).toBe(byId("x"));
	});

	it("ignores focus inside the palette and on focus guards", () =>
	{
		setUp(`
			<button id="x">X</button>
			<span id="guard" tabindex="0" data-base-ui-focus-guard></span>
			<div data-command-palette><input id="search" /></div>`);
		byId("x").focus();
		byId("search").focus();
		byId("guard").focus();
		expect(paletteFocusOrigin()).toBe(byId("x"));
	});

	it("resets on focus to nothing while no palette is open, but not while one is", () =>
	{
		setUp(`<button id="x">X</button><div id="palette"></div>`);
		const x = byId("x");
		byId("palette").setAttribute("data-command-palette", "");
		x.focus();
		x.dispatchEvent(
			new FocusEvent(
				"focusout",
				{
					bubbles: true,
					relatedTarget: null,
				},
			),
		);
		const whileOpen = paletteFocusOrigin();
		byId("palette").remove();
		x.dispatchEvent(
			new FocusEvent(
				"focusout",
				{
					bubbles: true,
					relatedTarget: null,
				},
			),
		);
		expect([whileOpen, paletteFocusOrigin()]).toStrictEqual([x, null]);
	});

	it("stops listening and resets on cleanup", () =>
	{
		setUp(`<button id="x">X</button><button id="y">Y</button>`);
		byId("x").focus();
		uninstall?.();
		uninstall = undefined;
		const afterCleanup = paletteFocusOrigin();
		byId("y").focus();
		expect([afterCleanup, paletteFocusOrigin()]).toStrictEqual([null, null]);
	});
});
