import {act} from "@testing-library/react";

/**
 * Runs `update` in an async act scope. Unlike a sync `act()`, React then drains the microtasks the update
 * queued (resolved fetch mocks, promise-driven state) before the returned promise settles.
 */
export async function actAndSettle(update: () => void): Promise<void> {
	await act(async () => {
		update();
		return Promise.resolve();
	});
}
