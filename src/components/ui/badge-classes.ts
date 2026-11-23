/**
 * Upstream's xxs cds Badge chip (`data-cds="Badge" data-size="xxs"`): 16px tall, 10px/13px medium text, 3px inline
 * padding inside a 1px transparent border, radius half the 16px height (r6).
 */
export const MENU_BADGE_CLASS =
	"inline-flex items-center gap-1 align-middle h-4 whitespace-nowrap text-[10px] leading-[13px] font-medium rounded-r6 border border-solid border-transparent px-[3px]";

/** The cds Badge's inner text span, which ellipsizes the label when the chip shrinks. */
export const MENU_BADGE_TEXT_CLASS = "min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap";
