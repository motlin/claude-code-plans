import {Blocks} from "lucide-react";

import {MenuItem} from "./ui/menu";
import {Spinner} from "./ui/spinner";

/** Upstream's `{label:"Connectors", loading:true, disabled:true}` row while the connector list is still loading. */
export function ConnectorsLoadingItem() {
	return (
		<MenuItem icon={<Blocks />} disabled trailing={<Spinner label="Loading" />}>
			Connectors
		</MenuItem>
	);
}
