import {describe, expect, it} from "vite-plus/test";
import {CooperativeQueue} from "../src/lib/cooperative-queue";

function settled(promise: Promise<void>): Promise<string> {
	return promise.then(
		() => "resolved",
		(error: unknown) => `rejected: ${(error as Error).message}`,
	);
}

describe("CooperativeQueue", () => {
	it("runs jobs one at a time in enqueue order", async () => {
		const queue = new CooperativeQueue();
		const events: string[] = [];
		const job = (name: string) => async () => {
			events.push(`start ${name}`);
			await new Promise((resolve) => setTimeout(resolve, 5));
			events.push(`end ${name}`);
		};

		await Promise.all([queue.enqueue("alice", job("alice")), queue.enqueue("bob", job("bob"))]);

		expect(events).toStrictEqual(["start alice", "end alice", "start bob", "end bob"]);
	});

	it("shares a waiting job with a later enqueue of the same key, but reruns a key that already started", async () => {
		const queue = new CooperativeQueue();
		const runs: string[] = [];
		let releaseFirst!: () => void;
		const first = queue.enqueue("alice", async () => {
			runs.push("alice 1");
			await new Promise<void>((resolve) => {
				releaseFirst = resolve;
			});
		});
		await new Promise((resolve) => setImmediate(resolve));
		const second = queue.enqueue("alice", async () => {
			runs.push("alice 2");
		});
		const duplicate = queue.enqueue("alice", async () => {
			runs.push("alice 3");
		});
		releaseFirst();
		await Promise.all([first, second, duplicate]);

		expect({runs, shared: second === duplicate}).toStrictEqual({runs: ["alice 1", "alice 2"], shared: true});
	});

	it("rejects only the failing job and keeps draining", async () => {
		const queue = new CooperativeQueue();
		const results = await Promise.all([
			settled(
				queue.enqueue("alice", async () => {
					throw new Error("alice failed");
				}),
			),
			settled(queue.enqueue("bob", async () => {})),
		]);

		expect(results).toStrictEqual(["rejected: alice failed", "resolved"]);
	});

	it("lets timers run between jobs once a slice is used up", async () => {
		const queue = new CooperativeQueue(0);
		const events: string[] = [];
		setTimeout(() => events.push("timer"), 0);
		const busyJob = (name: string) => async () => {
			const start = performance.now();
			while (performance.now() - start < 5) {
				// Synchronous work, like an SQLite write.
			}
			events.push(name);
		};

		await Promise.all(["alice", "bob", "carol"].map((name) => queue.enqueue(name, busyJob(name))));

		expect(events.indexOf("timer")).toBeLessThan(events.indexOf("carol"));
	});
});
