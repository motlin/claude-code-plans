import {vi} from "vite-plus/test";

/** A ResizeObserver stand-in whose callbacks fire only when the test calls `resize(width)`. */
export interface WidthObservers
{
	/** Reports `width` as the content width of every observed element. */
	readonly resize: (width: number) => void;
}

/** The part of a ResizeObserverEntry the observed code reads. */
interface WidthEntry
{
	target: Element;
	contentRect:
	{
		width: number;
	};
}

export function installWidthObservers(): WidthObservers
{
	const live = new Set<WidthObserver>();

	class WidthObserver
	{
		readonly targets = new Set<Element>();

		constructor(readonly callback: (entries: WidthEntry[], observer: WidthObserver) => void)
		{
			live.add(this);
		}
		observe(target: Element)
		{
			this.targets.add(target);
		}
		unobserve(target: Element)
		{
			this.targets.delete(target);
		}
		disconnect()
		{
			this.targets.clear();
			live.delete(this);
		}
		takeRecords()
		{
			return [];
		}
	}

	vi.stubGlobal("ResizeObserver", WidthObserver);
	return {
		resize: (width) =>
		{
			for (const observer of [...live])
			{
				const entries = [...observer.targets].map((target): WidthEntry => (
				{
					target,
					contentRect:
					{
						width,
					},
				}));
				if (entries.length > 0) observer.callback(entries, observer);
			}
		},
	};
}
