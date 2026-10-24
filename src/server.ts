import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CATEGORY_IDS } from './data/categories.js';
import { MAX_RANGE_DAYS, SeoulEventsService, type SearchResult, type ServiceConfig } from './service.js';
import { UpstreamError, UserInputError } from './types.js';

export const SERVER_NAME = 'seoul-events-mcp';
export const SERVER_VERSION = '0.1.0';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const date = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD, e.g. 2026-10-31')
	.describe('Date in Seoul time, YYYY-MM-DD');

const category = z
	.union([z.enum(CATEGORY_IDS), z.array(z.enum(CATEGORY_IDS)).min(1).max(5)])
	.transform((v) => (Array.isArray(v) ? v : [v]))
	.describe('One category id or a list (see list_categories), e.g. "exhibition-art" or ["tech","business"]');

const filters = {
	district: z
		.string()
		.min(1)
		.max(40)
		.optional()
		.describe('Seoul district or neighborhood: "Gangnam", "Mapo-gu", "종로구", "Hongdae", "Itaewon", "Seongsu"…'),
	category: category.optional(),
	free_only: z.boolean().optional().describe('Only free events'),
	english_friendly: z
		.boolean()
		.optional()
		.describe('Only events that work for non-Korean speakers (English listing, international crowd, or non-verbal like concerts/exhibitions)'),
	limit: z.number().int().min(1).max(50).optional().describe('Max events to return (default 10, max 50)'),
};

export function createServer(service: SeoulEventsService | ServiceConfig = {}): McpServer {
	const svc = service instanceof SeoulEventsService ? service : new SeoulEventsService(service);
	const server = new McpServer(
		{ name: SERVER_NAME, version: SERVER_VERSION },
		{
			instructions:
				'Current events in Seoul for English speakers: community meetups, tech talks, language exchanges (Eventify: Meetup/Luma/community) ' +
				'plus concerts, exhibitions, festivals and performances (Seoul Culture Portal). Dates are Seoul time (KST). ' +
				'Seoul Culture Portal titles are Korean (kept in title_ko): translate them for the user and always share the event url and source.',
		},
	);

	server.registerTool(
		'search_events',
		{
			title: 'Search Seoul events',
			description:
				`Search current and upcoming events in Seoul by keyword, date range, district, category, price and English-friendliness. ` +
				`Combines Eventify (meetups, tech, language exchange, social; English-first) and the Seoul Culture Portal (concerts, exhibitions, festivals, theater). ` +
				`English keywords also match Korean titles (e.g. "jazz" → 재즈). Defaults: the next 7 days; max range ${MAX_RANGE_DAYS} days.`,
			inputSchema: {
				query: z.string().max(100).optional().describe('Keywords, e.g. "jazz", "AI agents", "language exchange", "kids"'),
				date_from: date.optional().describe('Start date (KST, YYYY-MM-DD). Default: today'),
				date_to: date.optional().describe('End date inclusive (KST). Default: date_from if given, else today + 6 days'),
				...filters,
				source: z.enum(['all', 'eventify', 'seoul']).optional().describe('Restrict to one source (default all)'),
			},
			annotations: { title: 'Search Seoul events', ...READ_ONLY },
		},
		async (args) => run(() => svc.search(args), formatSearch),
	);

	server.registerTool(
		'events_this_weekend',
		{
			title: 'Events this weekend in Seoul',
			description:
				'Events in Seoul this weekend (Saturday–Sunday, Seoul time; if today is Saturday or Sunday, the current weekend). Same filters as search_events.',
			inputSchema: { query: z.string().max(100).optional().describe('Optional keywords'), ...filters },
			annotations: { title: 'Events this weekend', ...READ_ONLY },
		},
		async (args) => {
			const { from, to } = svc.weekend();
			return run(() => svc.search({ ...args, date_from: from, date_to: to, limit: args.limit ?? 15 }), formatSearch);
		},
	);

	server.registerTool(
		'get_event',
		{
			title: 'Get event details',
			description:
				'Full details for one event by id from search results ("eventify:<id>" or "seoul:<code>"): time, venue, price, longer description, link, source.',
			inputSchema: { id: z.string().min(3).max(80).describe('Event id from search_events, e.g. "eventify:6ad6f2ff0b4da32bbda46e26"') },
			annotations: { title: 'Get event details', ...READ_ONLY },
		},
		async ({ id }) => run(() => svc.getEvent(id), (e) => `Event ${e.id} — ${e.title}`),
	);

	server.registerTool(
		'list_categories',
		{
			title: 'List event categories',
			description: 'The category ids accepted by search_events, with English labels, which source uses them and the original Korean labels.',
			inputSchema: {},
			annotations: { title: 'List categories', ...READ_ONLY, openWorldHint: false },
		},
		async () => run(async () => ({ categories: svc.listCategories() }), (r) => `${r.categories.length} categories`),
	);

	server.registerTool(
		'list_districts',
		{
			title: 'List Seoul districts',
			description: "Seoul's 25 districts (gu) with Korean names and well-known neighborhoods, for the district filter.",
			inputSchema: {},
			annotations: { title: 'List districts', ...READ_ONLY, openWorldHint: false },
		},
		async () => run(async () => ({ districts: svc.listDistricts() }), (r) => `${r.districts.length} districts`),
	);

	return server;
}

function formatSearch(r: SearchResult): string {
	const head = `Found ${r.total_matches} event(s) in Seoul ${r.date_range.from}${r.date_range.to !== r.date_range.from ? ` to ${r.date_range.to}` : ''} (KST); showing ${r.returned}.`;
	const lines = r.events.map((e, i) => {
		const when = e.start.length > 10 ? e.start.replace('T', ' ').slice(0, 16) : e.start === e.end ? e.start : `${e.start} – ${e.end}`;
		const where = e.online ? 'Online' : [e.venue, e.district].filter(Boolean).join(', ') || e.address || 'Seoul';
		const price = e.is_free ? 'Free' : (e.price ?? 'price n/a');
		return `${i + 1}. ${e.title} | ${when} | ${where} | ${price} | ${e.categories.join('/')} | ${e.source.name} | id=${e.id}`;
	});
	const warn = r.warnings.length ? `\nNotes: ${r.warnings.join(' ')}` : '';
	return [head, ...lines].join('\n') + warn;
}

/** Runs a tool body: success → readable summary + JSON; known errors → isError with a helpful message. */
async function run<T>(fn: () => Promise<T>, summarize: (r: T) => string): Promise<CallToolResult> {
	try {
		const result = await fn();
		return {
			content: [
				{ type: 'text', text: summarize(result) },
				{ type: 'text', text: JSON.stringify(result, null, 2) },
			],
		};
	} catch (err) {
		const msg =
			err instanceof UserInputError
				? err.message
				: err instanceof UpstreamError
					? `Upstream data source error: ${err.message}. Try again in a minute.`
					: `Unexpected error: ${(err as Error).message}`;
		return { isError: true, content: [{ type: 'text', text: msg }] };
	}
}
