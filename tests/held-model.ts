/** A stubbed model whose answer arrives only when the test releases it, and which reports when it was asked. */
export function heldModel(): {
	asked: Promise<undefined>;
	release: (answer: string) => void;
	run: (prompt: string) => Promise<string>;
} {
	let markAsked = () => {};
	const asked = new Promise<undefined>((done) => {
		markAsked = () => {
			done(undefined);
		};
	});
	let release: (answer: string) => void = () => {};
	const answer = new Promise<string>((done) => {
		release = done;
	});
	return {
		asked,
		release,
		run: async () => {
			markAsked();
			return answer;
		},
	};
}

/** Let a background worker finish the microtasks and file reads queued behind a released model answer. */
export async function flushWorker(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await new Promise((done) => {
			setImmediate(done);
		});
	}
}
