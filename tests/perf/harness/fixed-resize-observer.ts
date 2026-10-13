import {vi} from "vite-plus/test";

export interface FixedSize {
	width: number;
	height: number;
}

/**
 * A deterministic jsdom `ResizeObserver` (measurement plan §4.3, L12): every observed element reports a fixed size,
 * synchronously on `observe`, so virtualizer layouts and commit counts do not depend on timing. Pass a function to give
 * elements different sizes.
 */
export function installFixedResizeObserver(size: FixedSize | ((element: Element) => FixedSize)): void {
	const sizeOf = typeof size === "function" ? size : () => size;

	class FixedResizeObserver {
		constructor(private readonly callback: ResizeObserverCallback) {}

		observe(target: Element): void {
			const {width, height} = sizeOf(target);
			const boxSize = [{inlineSize: width, blockSize: height}];
			const contentRect = {x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height};
			const entry: ResizeObserverEntry = {
				target,
				contentRect: {...contentRect, toJSON: () => contentRect},
				borderBoxSize: boxSize,
				contentBoxSize: boxSize,
				devicePixelContentBoxSize: boxSize,
			};
			this.callback([entry], this);
		}

		unobserve(): void {}

		disconnect(): void {}

		takeRecords(): Array<ResizeObserverEntry> {
			return [];
		}
	}

	vi.stubGlobal("ResizeObserver", FixedResizeObserver);
}
