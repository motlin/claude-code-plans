// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {ElicitationFormCard, type ElicitationAnswer} from "../src/components/elicitation-form-card";
import type {ElicitationFormSchema} from "../src/lib/elicitation-form";

afterEach(cleanup);

const schema: ElicitationFormSchema = {
	type: "object",
	properties: {
		username: {type: "string", title: "Username", description: "Your login"},
		count: {type: "integer", title: "Count", default: 2},
		remember: {type: "boolean", title: "Remember me"},
		color: {type: "string", title: "Color", enum: ["red", "blue"], enumNames: ["Red", "Blue"]},
		tags: {type: "array", title: "Tags", items: {enum: ["a", "b"]}},
	},
	required: ["username"],
};

function renderCard(onAnswer: (answer: ElicitationAnswer) => Promise<void> = async () => {}) {
	return render(
		<ElicitationFormCard
			serverName="my-mcp-server"
			message="Please provide your credentials"
			schema={schema}
			fieldNames={["username", "count", "remember", "color", "tags"]}
			onAnswer={onAnswer}
		/>,
	).container;
}

describe("ElicitationFormCard", () => {
	it("draws upstream's heading, message, form, caution and Decline / Submit in order", () => {
		const container = renderCard();
		const form = container.querySelector("[data-testid=epitaxy-elicitation-form]");
		const caution = container.querySelector("[data-testid=epitaxy-elicitation-caution]");

		expect({
			label: container.querySelector("[data-approval-card-root]")?.getAttribute("aria-label"),
			heading: container.querySelector("[data-approval-card-title]")?.textContent,
			message: container.querySelector("[data-elicitation-message]")?.textContent,
			messageClass: container.querySelector("[data-elicitation-message]")?.getAttribute("class"),
			formClass: form?.getAttribute("class"),
			fields: [...container.querySelectorAll("[data-elicitation-field] [data-field-label]")].map(
				(label) => label.textContent,
			),
			caution: caution?.textContent,
			cautionClass: caution?.getAttribute("class"),
			buttons: [...container.querySelectorAll("[data-approval-card-actions] button")].map(
				(button) => button.textContent,
			),
		}).toStrictEqual({
			label: "my-mcp-server requests your input",
			heading: "my-mcp-server requests your input",
			message: "Please provide your credentials",
			messageClass:
				"text-body text-muted-as-secondary whitespace-pre-wrap [overflow-wrap:anywhere] [unicode-bidi:plaintext]",
			formClass: "flex flex-col gap-2",
			fields: ["Username*", "Count", "Remember me", "Color", "Tags"],
			caution: "Don’t enter passwords or verification codes here.",
			cautionClass: "text-body text-muted-as-secondary",
			buttons: ["Decline", "Submit"],
		});
	});

	it("blocks Submit with an empty required field and shows upstream's message", () => {
		const onAnswer = vi.fn<(answer: ElicitationAnswer) => Promise<void>>(async () => {});
		renderCard(onAnswer);

		fireEvent.click(screen.getByRole("button", {name: "Submit"}));

		expect({
			calls: onAnswer.mock.calls,
			alerts: screen.getAllByText("This field is required.").map((node) => node.id.endsWith("-error")),
			invalid: screen.getByRole("textbox", {name: "Username"}).getAttribute("aria-invalid"),
		}).toStrictEqual({calls: [], alerts: [true], invalid: "true"});
	});

	it("submits the parsed answer and holds both buttons while it is sent", () => {
		const onAnswer = vi.fn<(answer: ElicitationAnswer) => Promise<void>>(async () => new Promise<void>(() => {}));
		renderCard(onAnswer);

		fireEvent.change(screen.getByRole("textbox", {name: "Username"}), {target: {value: "ada"}});
		fireEvent.click(screen.getByRole("checkbox", {name: "Remember me"}));
		fireEvent.change(screen.getByRole("combobox", {name: "Color"}), {target: {value: "blue"}});
		fireEvent.click(screen.getByRole("checkbox", {name: "b"}));
		fireEvent.click(screen.getByRole("button", {name: "Submit"}));

		expect({
			calls: onAnswer.mock.calls,
			disabled: screen
				.getAllByRole("button")
				.filter((button) => button.hasAttribute("disabled"))
				.map((b) => b.textContent),
		}).toStrictEqual({
			calls: [
				[{action: "accept", content: {username: "ada", count: 2, remember: true, color: "blue", tags: ["b"]}}],
			],
			disabled: ["Decline", "Submit"],
		});
	});

	it("answers decline from Decline, and re-enables the buttons with the error when the answer fails", async () => {
		const onAnswer = vi.fn<(answer: ElicitationAnswer) => Promise<void>>(async () =>
			Promise.reject(new Error("The terminal is not showing this elicitation")),
		);
		renderCard(onAnswer);

		fireEvent.click(screen.getByRole("button", {name: "Decline"}));
		const alert = await screen.findByRole("alert");

		expect({
			calls: onAnswer.mock.calls,
			alert: alert.textContent,
			declineDisabled: screen.getByRole("button", {name: "Decline"}).hasAttribute("disabled"),
		}).toStrictEqual({
			calls: [[{action: "decline"}]],
			alert: "The terminal is not showing this elicitation",
			declineDisabled: false,
		});
	});

	it("swallows Esc so it never declines the form", () => {
		const container = renderCard();
		const root = container.querySelector("[data-approval-card-root]");
		const event = new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true});

		root?.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
	});

	it("shows a Reset button once a field differs from its initial value, which restores it", () => {
		renderCard();
		const count = screen.getByRole("spinbutton", {name: "Count"});

		const before = screen.queryByRole("button", {name: "Reset Count"});
		fireEvent.change(count, {target: {value: "5"}});
		fireEvent.click(screen.getByRole("button", {name: "Reset Count"}));

		expect({
			before,
			value: count.getAttribute("value") ?? (count instanceof HTMLInputElement ? count.value : null),
			after: screen.queryByRole("button", {name: "Reset Count"}),
		}).toStrictEqual({before: null, value: "2", after: null});
	});

	it("clears a field's submit error once it is edited", () => {
		renderCard();

		fireEvent.click(screen.getByRole("button", {name: "Submit"}));
		const shown = screen.queryAllByText("This field is required.").length;
		fireEvent.change(screen.getByRole("textbox", {name: "Username"}), {target: {value: "ada"}});

		expect({shown, after: screen.queryAllByText("This field is required.").length}).toStrictEqual({
			shown: 1,
			after: 0,
		});
	});
});
