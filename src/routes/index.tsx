import { createFileRoute } from "@tanstack/react-router";
import { HomeComposer } from "../components/home/home-composer";
import { HomeLocalSections } from "../components/home/local-sections";
import { HomePage } from "../components/home/home-page";
import { HomeSessionsSection } from "../components/home/home-sessions-section";

export const Route = createFileRoute("/")({
  component: Home,
  staticData: { fullBleed: true },
  head: () => ({
    meta: [{ title: "Claude Code Browser" }],
  }),
});

function Home() {
  return (
    <HomePage dock={<HomeComposer />}>
      <div data-home-action-center className="flex flex-col gap-10 pt-6 pb-14">
        <HomeSessionsSection />
        <HomeLocalSections />
      </div>
    </HomePage>
  );
}
