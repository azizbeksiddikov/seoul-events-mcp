/**
 * Tiny scripted eval: 10 natural-language questions a foreigner in Seoul might ask an assistant,
 * each mapped to the tool call an assistant should make, with checks on the tool output.
 *
 *   npm run eval         # deterministic: in-memory server + recorded fixtures (Sat 2026-10-24)
 *   npm run eval:live    # spawns the built stdio server (dist/index.js) against the live APIs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from '../src/server.js';
import { makeService } from '../test/helpers.js';

const LIVE = process.argv.includes('--live');

interface Ev {
	id: string;
	title: string;
	categories: string[];
	district?: string;
	is_free: boolean | null;
	english_friendly: boolean;
	start: string;
	end: string;
	url?: string;
	source: { id: string; attribution: string };
	online: boolean;
}

interface Case {
	question: string;
	tool: string;
	args: (ctx: { today: string }) => Record<string, unknown>;
	/** Return a failure reason, or null if the output answers the question. */
	check: (out: any, isError: boolean) => string | null;
}

const every = (evs: Ev[], pred: (e: Ev) => boolean, what: string) => (evs.every(pred) ? null : `not every event ${what}`);
const nonEmpty = (evs: Ev[]) => (evs.length ? null : 'no events returned');
const all = (...rs: Array<string | null>) => rs.find((r) => r) ?? null;
const attributed = (evs: Ev[]) => every(evs, (e) => !!e.url && !!e.source.attribution, 'has a url + source attribution');

const CASES: Case[] = [
	{
		question: "What's happening in Seoul this weekend?",
		tool: 'events_this_weekend',
		args: () => ({}),
		check: (o) => all(nonEmpty(o.events), attributed(o.events), every(o.events, (e) => e.end.slice(0, 10) >= o.date_range.from && e.start.slice(0, 10) <= o.date_range.to, 'overlaps the weekend')),
	},
	{
		question: 'Any free events in Gangnam this week?',
		tool: 'search_events',
		args: () => ({ district: 'Gangnam', free_only: true }),
		check: (o) => all(nonEmpty(o.events), every(o.events, (e) => e.district === 'Gangnam-gu' && e.is_free === true, 'is free and in Gangnam-gu')),
	},
	{
		question: 'Are there tech or AI meetups coming up?',
		tool: 'search_events',
		args: () => ({ category: ['tech'], limit: 20 }),
		check: (o) => all(nonEmpty(o.events), every(o.events, (e) => e.categories.includes('tech'), 'is tagged tech')),
	},
	{
		question: "I don't speak Korean — what can I go to this week?",
		tool: 'search_events',
		args: () => ({ english_friendly: true, limit: 20 }),
		check: (o) => all(nonEmpty(o.events), every(o.events, (e) => e.english_friendly, 'is english_friendly')),
	},
	{
		question: 'Where can I practice Korean? Any language exchange?',
		tool: 'search_events',
		args: () => ({ query: 'language exchange', limit: 5 }),
		check: (o) => all(nonEmpty(o.events), every(o.events.slice(0, 1), (e) => /language|exchange|언어|교환/i.test(JSON.stringify(e)), 'top hit mentions language exchange')),
	},
	{
		question: 'Show me art exhibitions I can visit this weekend.',
		tool: 'events_this_weekend',
		args: () => ({ category: 'exhibition-art' }),
		check: (o) => all(nonEmpty(o.events), every(o.events, (e) => e.categories.includes('exhibition-art'), 'is an exhibition')),
	},
	{
		question: 'Anything happening around Hongdae / Mapo in the next two weeks?',
		tool: 'search_events',
		args: ({ today }) => ({ district: 'Hongdae', date_from: today, date_to: addDays(today, 13), limit: 20 }),
		check: (o) => all(nonEmpty(o.events), every(o.events, (e) => e.district === 'Mapo-gu', 'is in Mapo-gu')),
	},
	{
		question: 'Tell me more about the first event you found.',
		tool: 'get_event',
		args: () => ({ id: '__FIRST_EVENTIFY_ID__' }),
		check: (o, err) => (err ? 'get_event errored' : all(o.id ? null : 'no id', o.url ? null : 'no url', o.title ? null : 'no title')),
	},
	{
		question: 'Is there something on December 40th?',
		tool: 'search_events',
		args: () => ({ date_from: '2026-12-40' }),
		check: (o, err) => (err ? null : 'invalid date was accepted'),
	},
	{
		question: 'What categories and areas can I filter by?',
		tool: 'list_districts',
		args: () => ({}),
		check: (o) => (o.districts?.length === 25 && o.districts.some((d: any) => d.name === 'Yongsan-gu') ? null : 'expected 25 districts'),
	},
];

function addDays(date: string, n: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

async function connect(): Promise<{ client: Client; today: string; close: () => Promise<void> }> {
	const client = new Client({ name: 'seoul-events-eval', version: '1.0.0' });
	if (LIVE) {
		const transport = new StdioClientTransport({ command: 'node', args: ['dist/index.js'], stderr: 'ignore' });
		await client.connect(transport);
		const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
		return { client, today, close: () => client.close() };
	}
	const { service } = makeService();
	const server = createServer(service);
	const [a, b] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(a), client.connect(b)]);
	return { client, today: service.today(), close: () => client.close() };
}

async function main() {
	const { client, today, close } = await connect();
	let firstEventifyId: string | undefined;
	let passed = 0;
	const rows: string[] = [];
	for (const [i, c] of CASES.entries()) {
		let args = c.args({ today });
		if (args.id === '__FIRST_EVENTIFY_ID__') args = { id: firstEventifyId ?? 'eventify:missing' };
		const t0 = Date.now();
		const res: any = await client.callTool({ name: c.tool, arguments: args });
		const ms = Date.now() - t0;
		const isError = res.isError === true;
		let out: any = null;
		if (!isError) out = JSON.parse(res.content[1].text);
		firstEventifyId ??= out?.events?.find((e: Ev) => e.source.id === 'eventify')?.id;
		let reason: string | null;
		try {
			// Checks that expect success dereference `out`, so a tool error surfaces in the catch below.
			reason = c.check(out, isError);
		} catch (e) {
			reason = isError ? `tool error: ${res.content[0].text}` : (e as Error).message;
		}
		if (!reason) passed++;
		const n = out?.events ? ` (${out.returned}/${out.total_matches} events)` : '';
		rows.push(`${reason ? 'FAIL' : 'PASS'}  Q${i + 1}. ${c.question}\n      → ${c.tool}(${JSON.stringify(args)})${n} ${ms}ms${reason ? `\n      ✗ ${reason}` : ''}`);
	}
	await close();
	console.log(`seoul-events-mcp eval — ${LIVE ? 'LIVE APIs via stdio' : 'fixtures, in-memory'} — today=${today} (KST)\n`);
	console.log(rows.join('\n'));
	console.log(`\n${passed}/${CASES.length} passed`);
	process.exit(passed === CASES.length ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
