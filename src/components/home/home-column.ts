/**
 * Upstream's 840px home column: 32px/40px gutters, narrowing to 16px/24px when the home tile (the
 * `tile-slot` container) is at most 560px wide. Tailwind's `@max-[560px]` compiles to `< 560px`,
 * so this spells out upstream's inclusive `max-width:560px` query.
 */
export const HOME_COLUMN =
	"mx-auto w-full max-w-[840px] pr-10 pl-8 [@container_tile-slot_(max-width:560px)]:pr-6 [@container_tile-slot_(max-width:560px)]:pl-4";
