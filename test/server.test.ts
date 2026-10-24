import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { makeService } from './helpers.js';

async function connect() {
	const { service } = makeService();
	const server = createServer(service);
	const [a, b] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'test', version: '1.0.0' });
	await Promise.all([server.connect(a), client.connect(b)]);
	return client;
}

function json(res: any) {
	return JSON.parse(res.content[1].text);
}

describe('MCP server', () => {
	it('lists the five read-only tools with schemas', async () => {
		const client = await connect();
		const { tools } = await client.listTools();
		expect(tools.map((t) => t.name).sort()).toEqual(['events_this_weekend', 'get_event', 'list_categories', 'list_districts', 'search_events']);
		for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
		const search = tools.find((t) => t.name === 'search_events')!;
		expect(Object.keys(search.inputSchema.properties ?? {})).toEqual(
			expect.arrayContaining(['query', 'date_from', 'date_to', 'district', 'category', 'free_only', 'limit']),
		);
	});

	it('events_this_weekend returns this Saturday-Sunday', async () => {
		const client = await connect();
		const res = await client.callTool({ name: 'events_this_weekend', arguments: { limit: 5 } });
		expect(res.isError).toBeFalsy();
		const r = json(res);
		expect(r.date_range.from).toBe('2026-10-24');
		expect(r.date_range.to).toBe('2026-10-25');
		expect(r.returned).toBe(5);
		expect((res.content as any)[0].text).toMatch(/^Found \d+ event\(s\)/);
	});

	it('accepts a single category string', async () => {
		const client = await connect();
		const res = await client.callTool({ name: 'search_events', arguments: { category: 'exhibition-art', date_from: '2026-10-24' } });
		expect(json(res).events.every((e: any) => e.categories.includes('exhibition-art'))).toBe(true);
	});

	it('rejects invalid arguments via zod with a clear error', async () => {
		const client = await connect();
		const res = await client.callTool({ name: 'search_events', arguments: { category: 'kpop', limit: 500 } });
		expect(res.isError).toBe(true);
		expect(JSON.stringify(res.content)).toMatch(/category|limit/);
	});

	it('returns isError with guidance for unknown districts', async () => {
		const client = await connect();
		const res = await client.callTool({ name: 'search_events', arguments: { district: 'Narnia' } });
		expect(res.isError).toBe(true);
		expect((res.content as any)[0].text).toMatch(/Unknown district/);
	});

	it('list_categories and list_districts', async () => {
		const client = await connect();
		expect(json(await client.callTool({ name: 'list_categories', arguments: {} })).categories).toHaveLength(20);
		expect(json(await client.callTool({ name: 'list_districts', arguments: {} })).districts).toHaveLength(25);
	});
});
