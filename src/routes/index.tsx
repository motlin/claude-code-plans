import {createFileRoute} from "@tanstack/react-router";
import {HomeComposer} from "../components/home/home-composer";
import {HomeLanding} from "../components/home/home-landing";

export const Route = createFileRoute("/")({
	component: Home,
	staticData: {fullBleed: true, tileShell: "home"},
	head: () => ({
		meta: [{title: "Claude Code Browser"}],
	}),
});

function Home() {
	return <HomeLanding dock={<HomeComposer />} />;
}
