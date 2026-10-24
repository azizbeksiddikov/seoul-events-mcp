import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SeoulEventsService } from '../src/service.js';
import type { FetchFn } from '../src/types.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const eventify = JSON.parse(readFileSync(join(FIX, 'eventify-events.json'), 'utf8')) as Record<string, any[]>;

/** Saturday 2026-10-24 12:00 KST */
export const FIXED_NOW = new Date('2026-10-24T03:00:00.000Z');

export interface MockOptions {
	failEventify?: boolean;
	failSeoul?: boolean;
	seoulXmlError?: boolean;
}

/** Fake fetch that serves fixtures for both upstream APIs and records every URL requested. */
export function mockFetch(opts: MockOptions = {}): FetchFn & { calls: string[] } {
	const calls: string[] = [];
	const fn = (async (url: string) => {
		calls.push(url);
		if (url.includes('/graphql')) {
			if (opts.failEventify) throw new Error('connect ECONNREFUSED');
			const u = new URL(url);
			const query = u.searchParams.get('query') ?? '';
			const vars = JSON.parse(u.searchParams.get('variables') ?? '{}');
			if (query.includes('getEvents')) {
				const list = eventify[vars.input.search.eventStatus] ?? [];
				return Response.json({ data: { getEvents: { list } } });
			}
			if (query.includes('getEvent')) {
				const all = [...eventify.UPCOMING, ...eventify.ONGOING];
				const hit = all.find((e) => e._id === vars.id);
				return hit
					? Response.json({ data: { getEvent: { ...hit, eventDesc: hit.eventDesc + ' '.repeat(3) + 'More details here.' } } })
					: Response.json({ errors: [{ code: 'INTERNAL_SERVER_ERROR', message: 'Event not found.' }], data: null });
			}
			return Response.json({ errors: [{ message: 'unknown query' }] }, { status: 400 });
		}
		if (url.includes('culturalEventInfo')) {
			if (opts.failSeoul) return new Response('Bad gateway', { status: 502 });
			if (opts.seoulXmlError)
				return new Response('<RESULT><CODE>INFO-100</CODE><MESSAGE><![CDATA[인증키가 유효하지 않습니다.]]></MESSAGE></RESULT>');
			const date = url.match(/(\d{4}-\d{2}-\d{2})$/)?.[1];
			const file = join(FIX, `seoul-${date}.json`);
			if (date && existsSync(file)) return new Response(readFileSync(file, 'utf8'));
			return Response.json({ RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } });
		}
		throw new Error(`unexpected URL ${url}`);
	}) as FetchFn & { calls: string[] };
	fn.calls = calls;
	return fn;
}

export function makeService(opts: MockOptions & { apiKey?: string } = {}) {
	const fetchFn = mockFetch(opts);
	const service = new SeoulEventsService({ fetchFn, now: () => FIXED_NOW, seoulApiKey: opts.apiKey });
	return { service, fetchFn };
}
