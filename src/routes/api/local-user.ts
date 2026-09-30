import {userInfo} from "node:os";
import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

function osUsername(): string | null {
	try {
		return userInfo().username || null;
	} catch {
		return null;
	}
}

export const Route = createFileRoute("/api/local-user")({
	server: {
		handlers: withMethodNotAllowed({
			GET: () => Response.json({username: osUsername()}),
		}),
	},
});
