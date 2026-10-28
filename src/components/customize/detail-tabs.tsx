import type {ReactNode} from "react";

/** Upstream `NavigationTabs` tab: 32px (`h-control`) tall, `px-md`, muted until hovered or current. */
export const DETAIL_TAB_CLASS =
	"relative -mb-px inline-flex h-8 shrink-0 items-center justify-center border-b-2 border-transparent px-3 text-body font-medium text-ink-muted no-underline hover:text-primary aria-[current=page]:border-primary aria-[current=page]:text-primary";

/** A tab's label in one inline run, with its optional " · N" count in upstream's muted-as-secondary. */
export function DetailTabLabel({label, count = null}: {label: string; count?: number | null}) {
	return (
		<span>
			{label}
			{count !== null && (
				<>
					{" "}
					<span className="text-muted-as-secondary">· {count}</span>
				</>
			)}
		</span>
	);
}

/** Upstream's detail tab strip: a hidden-scrollbar horizontal scroller around the underline nav. */
export function DetailTabs({label, children}: {label: string; children: ReactNode}) {
	return (
		<div className="-m-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
			<nav aria-label={label} className="flex w-max min-w-full items-end gap-[2px] border-b border-border">
				{children}
			</nav>
		</div>
	);
}
