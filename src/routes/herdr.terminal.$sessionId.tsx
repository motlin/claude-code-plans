import { createFileRoute, Link } from "@tanstack/react-router";
import { HerdrTerminal } from "../components/herdr-terminal";

export const Route = createFileRoute("/herdr/terminal/$sessionId")({
  component: HerdrTerminalPage,
  head: () => ({ meta: [{ title: "Live Herdr terminal" }] }),
});

function HerdrTerminalPage() {
  const { sessionId } = Route.useParams();
  return (
    <div>
      <div className="flex items-center gap-3">
        <Link to="/herdr" className="text-sm text-text-500 hover:text-text-000">
          Herdr
        </Link>
        <span className="text-text-500">/</span>
        <h1 className="text-lg font-semibold">Live terminal</h1>
      </div>
      <HerdrTerminal sessionId={sessionId} />
    </div>
  );
}
