import {FileText, FileCode, FileJson, File} from "lucide-react";

export function getFileIcon(name: string) {
	const ext = name.split(".").pop()?.toLowerCase();
	switch (ext) {
		case "md":
			return FileText;
		case "ts":
		case "tsx":
		case "js":
		case "jsx":
		case "py":
		case "sh":
			return FileCode;
		case "json":
			return FileJson;
		default:
			return File;
	}
}
