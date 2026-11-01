import {writeClipboardText} from "../../lib/clipboard";
import {useToast} from "../toast-context";
import {pluginInstallCommand} from "./plugin-view";

/** Copies `claude plugin install <id>` and toasts "Command copied: <command>". */
export function useCopyInstallCommand() {
	const toast = useToast();
	return async (pluginId: string) => {
		const command = pluginInstallCommand(pluginId);
		const copied = await writeClipboardText(command);
		toast(
			copied ? {kind: "success", message: `Command copied: ${command}`} : {kind: "error", message: "Copy failed"},
		);
	};
}
