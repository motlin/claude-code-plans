import {asRecord} from "../narrow";
import {herdrRequest, type HerdrResult} from "./client";
import type {HerdrRequester} from "./panes";

/** herdr's `pane.read` of the visible screen, as plain text or with its colour escapes (`ansi`). */
export async function readHerdrScreen(
	paneId: string,
	request: HerdrRequester = herdrRequest,
	format: "text" | "ansi" = "text",
): Promise<HerdrResult<string>> {
	const response = await request({
		id: `ccp:plan-read:${crypto.randomUUID()}`,
		method: "pane.read",
		params:
			format === "ansi"
				? {pane_id: paneId, source: "visible", format: "ansi", strip_ansi: false}
				: {pane_id: paneId, source: "visible"},
	});
	if (!response.ok) return response;
	const text = asRecord(asRecord(response.value)?.["read"])?.["text"];
	return typeof text === "string"
		? {ok: true, value: text}
		: {ok: false, code: "bad-response", message: "herdr returned no pane text"};
}
