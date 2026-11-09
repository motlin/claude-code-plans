import {createFileRoute} from "@tanstack/react-router";
import {withMethodNotAllowed} from "../../lib/api/method-not-allowed";

export const Route = createFileRoute("/api/permission-mode-consent")({
	server: {
		handlers: withMethodNotAllowed({
			GET: async () => {
				const {handlePermissionModeConsentGet, nodeConsentStoreDependencies} =
					await import("../../lib/permission-mode-consent-server");
				return handlePermissionModeConsentGet(await nodeConsentStoreDependencies());
			},
			POST: async ({request}: {request: Request}) => {
				const {handlePermissionModeConsentPost, nodeConsentStoreDependencies} =
					await import("../../lib/permission-mode-consent-server");
				return handlePermissionModeConsentPost(request, await nodeConsentStoreDependencies());
			},
		}),
	},
});
