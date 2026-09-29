import { useLayoutEffect, useRef, useState } from "react";

import { highlightMatches, isCustomCommand, type SlashCommand } from "../lib/slash-commands";

const POPUP_CLASS =
  "absolute bottom-full left-0 z-[130] mb-2 flex max-h-96 w-60 max-w-lg flex-col rounded-card bg-[var(--menu-bg)] text-body text-primary shadow-[var(--menu-shadow)] select-none";

const ROW_CLASS =
  "flex w-full cursor-default items-center rounded-r6 px-2.5 py-1.5 text-body outline-none data-[highlighted]:bg-fill-ghost-hover";

const TOOLTIP_CLASS =
  "pointer-events-none absolute left-full z-[130] ml-2 w-max max-w-[240px] rounded-md bg-[var(--tooltip-bg)] px-2 py-1 text-xs text-[var(--tooltip-fg)] line-clamp-10";

function Highlighted({ text, query }: { text: string; query: string }) {
  return highlightMatches(text, query).map((segment, i) =>
    segment.match ? (
      <span key={i} className="font-semibold">
        {segment.text}
      </span>
    ) : (
      segment.text
    ),
  );
}

export function slashCommandOptionId(menuId: string, index: number): string {
  return `${menuId}-option-${index}`;
}

/**
 * The claude.ai/code "/" popup: a 240px menu above the composer with the
 * highlighted row's description as a dark tooltip beside it. Keyboard focus
 * stays in the editor, which drives `highlighted` and `onAccept`.
 */
export function SlashCommandMenu({
  id,
  commands,
  query,
  highlighted,
  onHighlight,
  onAccept,
}: {
  id: string;
  commands: readonly SlashCommand[];
  query: string;
  highlighted: number;
  onHighlight: (index: number) => void;
  onAccept: (command: SlashCommand) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [tooltipTop, setTooltipTop] = useState(0);
  const active = commands[highlighted];

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const row = scroller?.querySelector<HTMLElement>("[data-highlighted]");
    if (!scroller || !row) return;
    row.scrollIntoView?.({ block: "nearest" });
    setTooltipTop(row.offsetTop - scroller.scrollTop);
  }, [highlighted, commands]);

  return (
    <div className={POPUP_CLASS} onMouseDown={(e) => e.preventDefault()}>
      <div
        ref={scrollerRef}
        id={id}
        role="menu"
        aria-label="Slash commands"
        className="min-h-0 overflow-y-auto rounded-[inherit] p-1"
        onScroll={(e) => {
          const row = e.currentTarget.querySelector<HTMLElement>("[data-highlighted]");
          if (row) setTooltipTop(row.offsetTop - e.currentTarget.scrollTop);
        }}
      >
        {commands.map((command, index) => (
          <div
            key={command.name}
            id={slashCommandOptionId(id, index)}
            role="menuitem"
            tabIndex={-1}
            data-highlighted={index === highlighted ? "" : undefined}
            className={ROW_CLASS}
            onMouseMove={() => {
              if (index !== highlighted) onHighlight(index);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              onAccept(command);
            }}
          >
            <span className="min-w-0 truncate">
              <Highlighted text={command.name} query={query} />
            </span>
            {isCustomCommand(command.source) && (
              <span className="ml-auto shrink-0 pl-2 text-caption text-muted">Custom command</span>
            )}
          </div>
        ))}
      </div>
      {active !== undefined && active.description !== "" && (
        <div role="tooltip" className={TOOLTIP_CLASS} style={{ top: tooltipTop }}>
          <Highlighted text={active.description} query={query} />
        </div>
      )}
    </div>
  );
}
