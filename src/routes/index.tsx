import { createFileRoute, Link } from "@tanstack/react-router";
import { useVisibleNavItems } from "../components/sidebar/navigation";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [{ title: "Claude Code Browser" }],
  }),
});

function Home() {
  const cards = useVisibleNavItems();

  return (
    <div>
      <h1 className="text-lg font-semibold">Claude Code Browser</h1>
      <div
        role="region"
        aria-label="Home sections"
        className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.to}
              to={card.to}
              className="group rounded-lg border border-border p-6 transition-colors hover:bg-surface-0/50"
            >
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 text-t6 group-hover:text-primary" />
                <h2 className="font-semibold">{card.label}</h2>
              </div>
              <p className="mt-2 text-sm text-t6">{card.description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
