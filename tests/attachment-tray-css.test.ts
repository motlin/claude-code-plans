import {readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

const styles = readFileSync("src/styles/globals.css", "utf8").replaceAll(/\s+/g, " ");

function missing(rules: readonly string[]): string[] {
	return rules.filter((rule) => !styles.includes(rule));
}

describe("composer attachment tray CSS", () => {
	it("defines upstream's horizontal scroll-fade-x utility on the shared scroll-fade variables", () => {
		expect(
			missing([
				'@property --scroll-fade-left-raw { syntax: "<length>"; inherits: false; initial-value: 0px; }',
				'@property --scroll-fade-right-raw { syntax: "<length>"; inherits: false; initial-value: 0px; }',
				'@property --scroll-fade-x-active { syntax: "<number>"; inherits: false; initial-value: 0; }',
				'@property --scroll-fade-left-on { syntax: "<number>"; inherits: false; initial-value: 1; }',
				'@property --scroll-fade-right-on { syntax: "<number>"; inherits: false; initial-value: 1; }',
				"@keyframes scroll-fade-left { 0% { --scroll-fade-left-raw: 0px; } to { --scroll-fade-left-raw: var(--scroll-fade-size); } }",
				"@keyframes scroll-fade-right { 0% { --scroll-fade-right-raw: var(--scroll-fade-size); } to { --scroll-fade-right-raw: 0px; } }",
				"@keyframes scroll-fade-x-active { 0%, to { --scroll-fade-x-active: 1; } }",
				"@utility scroll-fade-x { scroll-padding-left: calc(var(--scroll-fade-size) * var(--scroll-fade-left-on)); scroll-padding-right: calc(var(--scroll-fade-size) * var(--scroll-fade-right-on));",
				"mask-image: linear-gradient( to right, transparent, #0000000d calc(var(--scroll-fade-left) * 0.15),",
				"#000 var(--scroll-fade-left), #000 calc(100% - var(--scroll-fade-right)),",
				"animation-name: scroll-fade-left, scroll-fade-right, scroll-fade-x-active;",
				"animation-timeline: scroll(self inline);",
			]),
		).toStrictEqual([]);
	});

	it("copies upstream's tile and tray enter motion, skipped for restored tiles", () => {
		expect(
			missing([
				"[data-cds-composer-attachments]:has([data-cds-attachment]) { transition: opacity 0.2s cubic-bezier(0.215, 0.61, 0.355, 1), transform 0.2s cubic-bezier(0.215, 0.61, 0.355, 1); }",
				"[data-cds-composer-attachments] [data-cds-attachment] { transform-origin: 0; view-transition-class: cds-attachment; transition: transform 0.18s cubic-bezier(0.215, 0.61, 0.355, 1), opacity 0.18s cubic-bezier(0.215, 0.61, 0.355, 1); }",
				'[data-cds-composer-attachments] [data-cds-attachment]:where(:dir(rtl), [dir="rtl"] *) { transform-origin: 100%; }',
				"@starting-style { [data-cds-composer-attachments]:has([data-cds-attachment]:not([data-cds-attachment-restored])) { opacity: 0; transform: translateY(-8px); } [data-cds-composer-attachments] [data-cds-attachment]:not([data-cds-attachment-restored]) { opacity: 0; transform: scale(0.92) translateY(4px); } }",
			]),
		).toStrictEqual([]);
	});

	it("copies upstream's cds-attachments view transition: 180ms slides and a 130ms shrink-out", () => {
		expect(
			missing([
				":root:active-view-transition-type(cds-attachments) [data-cds-composer-attachments] [data-cds-attachment] { view-transition-name: var(--cds-attachment-vt-name); }",
				":root:active-view-transition-type(cds-attachments) { view-transition-name: none; }",
				":root:active-view-transition-type(cds-attachments)::view-transition-group(root) { animation-duration: 0s; }",
				":root:active-view-transition-type(cds-attachments)::view-transition-group(.cds-attachment) { animation-duration: 0.18s; animation-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1); }",
				"@keyframes cds-attachment-out { to { opacity: 0; transform: scale(0.5); } }",
				":root:active-view-transition-type(cds-attachments)::view-transition-old(.cds-attachment):only-child { animation: 0.13s cubic-bezier(0.55, 0.055, 0.675, 0.19) forwards cds-attachment-out; }",
			]),
		).toStrictEqual([]);
	});

	it("turns the tile and tray transitions off under reduced motion, OS or Settings", () => {
		expect(
			missing([
				"@media (prefers-reduced-motion: reduce) { [data-cds-composer-attachments]:has([data-cds-attachment]), [data-cds-composer-attachments] [data-cds-attachment] { transition: none; } }",
				'html[data-reduce-motion="true"] [data-cds-composer-attachments]:has([data-cds-attachment]), html[data-reduce-motion="true"] [data-cds-composer-attachments] [data-cds-attachment] { transition: none; }',
			]),
		).toStrictEqual([]);
	});
});
