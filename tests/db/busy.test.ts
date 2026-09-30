import {describe, expect, it} from "vite-plus/test";
import {isBusyError, retryWhileBusy} from "../../src/lib/db/busy";

function busyError(): Error {
	return Object.assign(new Error("database is locked"), {code: "SQLITE_BUSY"});
}

describe("isBusyError", () => {
	it("recognizes SQLITE_BUSY directly, as an extended code, and as a wrapped cause", () => {
		expect([
			isBusyError(busyError()),
			isBusyError(Object.assign(new Error("x"), {code: "SQLITE_BUSY_SNAPSHOT"})),
			isBusyError(new Error("Failed to run the query", {cause: busyError()})),
			isBusyError(Object.assign(new Error("x"), {code: "SQLITE_CONSTRAINT"})),
			isBusyError("SQLITE_BUSY"),
		]).toStrictEqual([true, true, true, false, false]);
	});
});

describe("retryWhileBusy", () => {
	it("runs the step again after a busy failure and yields to the event loop in between", async () => {
		let attempts = 0;
		let timerRanBetweenAttempts = false;
		setTimeout(() => {
			timerRanBetweenAttempts = attempts === 1;
		}, 0);

		const result = await retryWhileBusy(() => {
			attempts++;
			if (attempts === 1) throw busyError();
			return "done";
		});

		expect({result, attempts, timerRanBetweenAttempts}).toStrictEqual({
			result: "done",
			attempts: 2,
			timerRanBetweenAttempts: true,
		});
	});

	it("rethrows any other error without retrying", async () => {
		let attempts = 0;
		const error = await retryWhileBusy(() => {
			attempts++;
			throw new Error("boom");
		}).catch((err: unknown) => err);

		expect({attempts, message: (error as Error).message}).toStrictEqual({attempts: 1, message: "boom"});
	});

	it("stops retrying once the signal is aborted", async () => {
		const controller = new AbortController();
		let attempts = 0;
		const error = await retryWhileBusy(() => {
			attempts++;
			controller.abort();
			throw busyError();
		}, controller.signal).catch((err: unknown) => err);

		expect({attempts, busy: isBusyError(error)}).toStrictEqual({attempts: 1, busy: true});
	});
});
