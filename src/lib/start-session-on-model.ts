import type {ToastOptions} from "../components/toast-context";
import type {HerdrLaunchResponse} from "./api/herdr";

/**
 * The escalated band's "Start a new session" (upstream `OO`: new-from-current with the streak's
 * original model), as a herdr launch in the session's folder with `--model`. Opens the new session
 * when herdr names it, and toasts a launch failure.
 */
export async function startSessionOnModel(
	cwd: string,
	model: string,
	{
		launch,
		toast,
		open,
	}:
	{
		launch: (request: {cwd: string; args: string[]}) => Promise<HerdrLaunchResponse>;
		toast: (options: ToastOptions) => void;
		open: (sessionId: string) => void;
	},
): Promise<void>
{
	try
	{
		const {sessionId} = await launch(
			{
				cwd,
				args: ["--model", model],
			},
		);
		if (sessionId === null)
			toast(
				{
					kind: "success",
					message: "Started a session in a new terminal tab",
				},
			);
		else open(sessionId);
	}
	catch (error)
	{
		toast(
			{
				kind: "error",
				message: "Couldn’t start a session. Try again.",
				description: error instanceof Error ? error.message : String(error),
			},
		);
	}
}
