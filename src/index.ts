#!/usr/bin/env node
import { createServer as createHttpServer } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';
import { SeoulEventsService } from './service.js';

const HELP = `${SERVER_NAME} ${SERVER_VERSION} — MCP server for current events in Seoul

Usage:
  seoul-events-mcp            Run over stdio (for Claude Desktop, Claude Code, Cursor)
  seoul-events-mcp --http     Run Streamable HTTP on http://localhost:$PORT/mcp (default 3000)
  seoul-events-mcp --help

Environment (all optional):
  SEOUL_OPEN_API_KEY   Free key from data.seoul.go.kr (without it: sample key, 5 culture events/day)
  EVENTIFY_API_URL     Eventify GraphQL endpoint (default https://eventify.azbek.me/api/graphql)
  CACHE_TTL_SECONDS    Cache lifetime (default 600)
  PORT                 Port for --http (default 3000)
`;

async function main() {
	const args = process.argv.slice(2);
	if (args.includes('--help') || args.includes('-h')) {
		process.stdout.write(HELP);
		return;
	}
	if (args.includes('--version')) {
		process.stdout.write(`${SERVER_VERSION}\n`);
		return;
	}

	const ttl = Number(process.env.CACHE_TTL_SECONDS);
	// One shared service so the cache survives across HTTP requests.
	const service = new SeoulEventsService({
		seoulApiKey: process.env.SEOUL_OPEN_API_KEY,
		eventifyApiUrl: process.env.EVENTIFY_API_URL,
		cacheTtlMs: Number.isFinite(ttl) && ttl > 0 ? ttl * 1000 : undefined,
	});

	if (args.includes('--http')) {
		const portArg = args[args.indexOf('--port') + 1];
		const port = Number(args.includes('--port') ? portArg : process.env.PORT) || 3000;
		const http = createHttpServer(async (req, res) => {
			const path = (req.url ?? '/').split('?')[0];
			if (path === '/health') {
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, name: SERVER_NAME, version: SERVER_VERSION }));
				return;
			}
			if (path !== '/mcp') {
				res.writeHead(404).end('Not found. MCP endpoint is /mcp');
				return;
			}
			if (req.method !== 'POST') {
				res.writeHead(405, { allow: 'POST' }).end('Method not allowed (stateless server: POST only)');
				return;
			}
			// Stateless mode: a fresh MCP server + transport per request.
			const server = createServer(service);
			const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
			res.on('close', () => {
				transport.close();
				server.close();
			});
			try {
				await server.connect(transport);
				await transport.handleRequest(req, res);
			} catch (err) {
				console.error('[seoul-events-mcp] request failed:', err);
				if (!res.headersSent) res.writeHead(500).end('Internal error');
			}
		});
		http.listen(port, () => console.error(`[seoul-events-mcp] Streamable HTTP on http://localhost:${port}/mcp`));
		return;
	}

	const server = createServer(service);
	await server.connect(new StdioServerTransport());
	console.error(`[seoul-events-mcp] ${SERVER_VERSION} running on stdio${service.seoul.usingSampleKey ? ' (Seoul sample key)' : ''}`);
}

main().catch((err) => {
	console.error('[seoul-events-mcp] fatal:', err);
	process.exit(1);
});
