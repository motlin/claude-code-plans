import {createFileRoute, redirect} from "@tanstack/react-router";

export const Route = createFileRoute("/customize/")({
	beforeLoad: () => {
		throw redirect({to: "/customize/skills", replace: true});
	},
});
