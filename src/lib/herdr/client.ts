import {createConnection, type Socket} from "node:net";
import {asRecord, errorMessage} from "../narrow";
import {routeHerdrRequest} from "./servers";

export type HerdrResult<T> = {ok: true; value: T} | {ok: false; code: string; message: string};

const MAXIMUM_REQUEST_BYTES = 1024 * 1024;

function failure(code: string, message: string): HerdrResult<never> {
	return {ok: false, code, message};
}

function serializeRequest(request: object): HerdrResult<string> {
	const fields: Record<string, unknown> = {...request};
	if (typeof fields["id"] !== "string") {
		return failure("invalid-request", "herdr request id must be a string");
	}
	if (typeof fields["method"] !== "string") {
		return failure("invalid-request", "herdr request method must be a string");
	}

	const params = Object.hasOwn(fields, "params") ? fields["params"] : {};
	if (params === null || typeof params !== "object" || Array.isArray(params)) {
		return failure("invalid-request", "herdr request params must be an object");
	}

	let line: string;
	try {
		line = `${JSON.stringify({...fields, params})}\n`;
	} catch (error) {
		return failure("invalid-request", errorMessage(error));
	}

	if (Buffer.byteLength(line) > MAXIMUM_REQUEST_BYTES) {
		return failure("request-too-large", "herdr requests cannot exceed 1 MiB");
	}

	return {ok: true, value: line};
}

function parseResponse(line: string): HerdrResult<unknown> {
	let message: unknown;
	try {
		message = JSON.parse(line);
	} catch {
		return failure("bad-response", "herdr returned invalid JSON");
	}

	const fields = asRecord(message);
	if (fields === undefined) {
		return failure("bad-response", "herdr returned an invalid response envelope");
	}

	if (Object.hasOwn(fields, "result")) {
		return {ok: true, value: fields["result"]};
	}
	if (Object.hasOwn(fields, "error")) {
		const responseError = fields["error"];
		const errorFields = asRecord(responseError);
		if (typeof errorFields?.["code"] === "string" && typeof errorFields["message"] === "string") {
			return failure(errorFields["code"], errorFields["message"]);
		}
	}

	return failure("bad-response", "herdr returned an invalid response envelope");
}

/**
 * Send one newline-delimited JSON request over a fresh herdr API connection.
 *
 * The server closes ordinary connections after one response. Its response id
 * may also be empty after a deserialization error, so the connection itself is
 * the correlation boundary.
 *
 * Without an explicit `socketPath`, the request goes to the server that owns
 * the qualified pane, tab or workspace id in its params (see `servers.ts`).
 */
export async function herdrRequest(
	request: object,
	timeoutMs = 5000,
	socketPath?: string,
): Promise<HerdrResult<unknown>> {
	let target = socketPath;
	let routedRequest = request;
	if (target === undefined) {
		const route = routeHerdrRequest(request);
		if (!route.ok) return route;
		target = route.value.socketPath;
		routedRequest = route.value.request;
	}
	const serializedRequest = serializeRequest(routedRequest);
	if (!serializedRequest.ok) return Promise.resolve(serializedRequest);

	return new Promise((resolve) => {
		let buffer = "";
		let settled = false;
		let socket: Socket | undefined;
		let timeout: NodeJS.Timeout | undefined;

		const finish = (result: HerdrResult<unknown>) => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			if (socket) {
				socket.off("connect", onConnect);
				socket.off("data", onData);
				socket.off("error", onError);
				socket.off("close", onClose);
				socket.destroy();
			}
			resolve(result);
		};

		const onConnect = () => {
			socket?.write(serializedRequest.value);
		};
		const onData = (chunk: Buffer) => {
			buffer += chunk.toString();
			const newlineIndex = buffer.indexOf("\n");
			if (newlineIndex === -1) return;
			finish(parseResponse(buffer.slice(0, newlineIndex)));
		};
		const onError = (error: Error) => {
			finish(failure("connect-failed", error.message));
		};
		const onClose = () => {
			finish(failure("closed", "herdr closed without a response"));
		};

		try {
			socket = createConnection(target);
			socket.setEncoding("utf8");
			socket.on("connect", onConnect);
			socket.on("data", onData);
			socket.on("error", onError);
			socket.on("close", onClose);
			timeout = setTimeout(() => {
				finish(failure("timeout", "herdr request timed out"));
			}, timeoutMs);
		} catch (error) {
			finish(failure("connect-failed", errorMessage(error)));
		}
	});
}
