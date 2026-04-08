import {createServer} from 'node:http';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NodeRequest, sendNodeResponse} from 'srvx/node';

const port = Number(process.env['PORT'] ?? 3000);
const serverEntryPath = join(import.meta.dirname, 'dist', 'server', 'server.js');

const imported = await import(pathToFileURL(serverEntryPath).toString());
const serverBuild = imported.default;

const server = createServer(async (req, res) => {
	const webReq = new NodeRequest({req, res});
	const webRes = await serverBuild.fetch(webReq);
	sendNodeResponse(res, webRes);
});

server.listen(port, '0.0.0.0', () => {
	console.log(`Listening on http://0.0.0.0:${port}`);
});
