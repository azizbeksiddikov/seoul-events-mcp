import { TtlCache } from './cache.js';
import { CATEGORIES, categoryInfo, type CategoryId } from './data/categories.js';
import { DISTRICTS, resolveDistrict } from './data/districts.js';
import { EventifySource } from './sources/eventify.js';
import { SeoulCultureSource } from './sources/seoul.js';
import { queryTerms } from './text.js';
import { addDays, daysBetween, eachDay, isIsoDate, kstDate, weekendRange } from './time.js';
import { toPublic, UserInputError, type FetchFn, type PublicEvent, type SeoulEvent, type SourceId } from './types.js';

export interface ServiceConfig {
	seoulApiKey?: string;
	eventifyApiUrl?: string;
	seoulBaseUrl?: string;
	cacheTtlMs?: number;
	fetchFn?: FetchFn;
	now?: () => Date;
}

export interface SearchParams {
	query?: string;
	date_from?: string;
	date_to?: string;
	district?: string;
	category?: CategoryId[];
	free_only?: boolean;
	english_friendly?: boolean;
	source?: 'all' | SourceId;
	limit?: number;
}

export interface SearchResult {
	date_range: { from: string; to: string; timezone: 'Asia/Seoul' };
	filters: Record<string, unknown>;
	total_matches: number;
	returned: number;
	events: PublicEvent[];
	warnings: string[];
	sources: Array<{ id: SourceId; name: string; status: 'ok' | 'error' | 'skipped'; attribution: string }>;
}

/** Longest range we query in one call; the Seoul API is queried once per day. */
export const MAX_RANGE_DAYS = 31;
const SEOUL_MAX_DAYS = 14;

export class SeoulEventsService {
	readonly eventify: EventifySource;
	readonly seoul: SeoulCultureSource;
	private readonly now: () => Date;

	constructor(cfg: ServiceConfig = {}) {
		const cache = new TtlCache(cfg.cacheTtlMs ?? 10 * 60_000);
		const fetchFn = cfg.fetchFn ?? ((u, i) => fetch(u, i));
		this.now = cfg.now ?? (() => new Date());
		this.eventify = new EventifySource({ apiUrl: cfg.eventifyApiUrl, fetchFn, cache });
		this.seoul = new SeoulCultureSource({ apiKey: cfg.seoulApiKey, baseUrl: cfg.seoulBaseUrl, fetchFn, cache });
	}

	today(): string {
		return kstDate(this.now());
	}

	weekend(): { from: string; to: string } {
		return weekendRange(this.now());
	}

	async search(p: SearchParams): Promise<SearchResult> {
		const { from, to } = this.resolveRange(p.date_from, p.date_to);
		const district = p.district ? resolveDistrict(p.district) : undefined;
		if (p.district && !district)
			throw new UserInputError(
				`Unknown district "${p.district}". Use a Seoul district like "Gangnam", "Mapo-gu", "종로구" or a neighborhood like "Hongdae" or "Itaewon" (see list_districts).`,
			);
		const source = p.source ?? 'all';
		const limit = p.limit ?? 10;
		const warnings: string[] = [];
		const sources: SearchResult['sources'] = [];

		const wantEventify = source === 'all' || source === 'eventify';
		const wantSeoul = source === 'all' || source === 'seoul';
		// The Seoul Culture Portal only lists arts & culture, so skip it when only Eventify categories are asked for.
		const seoulRelevant = !p.category?.length || p.category.some((c) => categoryInfo(c).seoul.length > 0);

		const [ev, se] = await Promise.allSettled([
			wantEventify ? this.eventify.listActive() : Promise.resolve([]),
			wantSeoul && seoulRelevant ? this.fetchSeoulRange(from, to, warnings) : Promise.resolve([]),
		]);

		let pool: SeoulEvent[] = [];
		const record = (id: SourceId, name: string, attribution: string, want: boolean, r: PromiseSettledResult<SeoulEvent[]>) => {
			if (!want) return sources.push({ id, name, status: 'skipped', attribution });
			if (r.status === 'fulfilled') {
				pool = pool.concat(r.value);
				sources.push({ id, name, status: 'ok', attribution });
			} else {
				warnings.push(`${name} is unavailable right now (${(r.reason as Error).message}). Results are from the other source only.`);
				sources.push({ id, name, status: 'error', attribution });
			}
		};
		record('eventify', 'Eventify', 'eventify.azbek.me (Meetup, Luma and community events)', wantEventify, ev);
		record(
			'seoul',
			'Seoul Culture Portal',
			'Seoul Open Data Plaza, culturalEventInfo (KOGL Type 1)',
			wantSeoul && seoulRelevant,
			se,
		);
		if (wantSeoul && seoulRelevant && this.seoul.usingSampleKey)
			warnings.push(
				'SEOUL_OPEN_API_KEY is not set, so the public sample key is used: at most 5 Seoul Culture Portal events per day. Get a free key at data.seoul.go.kr for full coverage.',
			);
		if (sources.every((s) => s.status !== 'ok') && sources.some((s) => s.status === 'error'))
			throw new Error(`All event sources failed. ${warnings.join(' ')}`);

		const terms = p.query ? queryTerms(p.query) : [];
		const dedup = new Map<string, SeoulEvent>();
		for (const e of pool) dedup.set(e.id, e);

		const scored: Array<{ e: SeoulEvent; score: number }> = [];
		for (const e of dedup.values()) {
			if (e._endDate < from || e._startDate > to) continue;
			if (district && e.district !== district.name) continue;
			if (p.category?.length && !e.categories.some((c) => p.category!.includes(c))) continue;
			if (p.free_only && e.is_free !== true) continue;
			if (p.english_friendly && !e.english_friendly) continue;
			let score = 0;
			if (terms.length) {
				const hay = haystack(e);
				score = terms.filter((alts) => alts.some((t) => hay.includes(t))).length;
				if (score === 0) continue;
			}
			scored.push({ e, score });
		}
		scored.sort((a, b) => b.score - a.score || sortKey(a.e, from).localeCompare(sortKey(b.e, from)) || a.e.title.localeCompare(b.e.title));
		const events = scored.slice(0, limit).map((s) => toPublic(s.e));

		if (!events.length)
			warnings.push(
				'No events matched. Try a wider date range, removing the district/category filter, or a different query word.',
			);

		return {
			date_range: { from, to, timezone: 'Asia/Seoul' },
			filters: stripUndefined({
				query: p.query,
				district: district?.name,
				category: p.category,
				free_only: p.free_only,
				english_friendly: p.english_friendly,
				source,
				limit,
			}),
			total_matches: scored.length,
			returned: events.length,
			events,
			warnings,
			sources,
		};
	}

	async getEvent(id: string): Promise<PublicEvent> {
		const m = id.trim().match(/^(eventify|seoul):(.+)$/);
		if (!m)
			throw new UserInputError(
				`Invalid id "${id}". Event ids look like "eventify:6ad6f2ff0b4da32bbda46e26" or "seoul:158770" — copy one from search_events results.`,
			);
		const [, src, raw] = m;
		if (src === 'eventify') {
			const e = await this.eventify.get(raw);
			if (!e) throw new UserInputError(`Eventify event "${id}" was not found (it may have been removed or ended).`);
			return toPublic(e);
		}
		const hit = this.seoul.lookup(id);
		if (hit) return toPublic(hit);
		throw new UserInputError(
			`Seoul Culture Portal event "${id}" is not in the local cache. The Seoul API has no lookup-by-id, so run search_events for the event's dates first, then call get_event again.`,
		);
	}

	listCategories() {
		return CATEGORIES.map((c) => ({
			id: c.id,
			label: c.label,
			sources: [c.eventify.length ? 'eventify' : null, c.seoul.length ? 'seoul' : null].filter(Boolean),
			korean_labels: c.seoul.length ? c.seoul : undefined,
			enjoyable_without_korean: c.nonVerbal === true,
		}));
	}

	listDistricts() {
		return DISTRICTS.map((d) => ({ name: d.name, korean: d.ko, neighborhoods: d.neighborhoods.filter((n) => /^[\x00-\x7F]+$/.test(n)) }));
	}

	private resolveRange(dateFrom?: string, dateTo?: string): { from: string; to: string } {
		for (const [k, v] of [
			['date_from', dateFrom],
			['date_to', dateTo],
		] as const)
			if (v !== undefined && !isIsoDate(v)) throw new UserInputError(`${k} must be a real date in YYYY-MM-DD format, got "${v}".`);
		const today = this.today();
		const from = dateFrom ?? (dateTo && dateTo < today ? dateTo : today);
		const to = dateTo ?? (dateFrom ? dateFrom : addDays(today, 6));
		if (to < from) throw new UserInputError(`date_to (${to}) is before date_from (${from}).`);
		if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS)
			throw new UserInputError(`Date range is ${daysBetween(from, to) + 1} days; the maximum is ${MAX_RANGE_DAYS}. Narrow it down.`);
		return { from, to };
	}

	private async fetchSeoulRange(from: string, to: string, warnings: string[]): Promise<SeoulEvent[]> {
		let days = eachDay(from, to);
		if (days.length > SEOUL_MAX_DAYS) {
			warnings.push(
				`Seoul Culture Portal was queried for the first ${SEOUL_MAX_DAYS} days of the range only (${days[0]}..${days[SEOUL_MAX_DAYS - 1]}); multi-day exhibitions and festivals still appear.`,
			);
			days = days.slice(0, SEOUL_MAX_DAYS);
		}
		const out: SeoulEvent[] = [];
		// Be gentle: at most 3 concurrent requests.
		for (let i = 0; i < days.length; i += 3) {
			const batch = await Promise.all(days.slice(i, i + 3).map((d) => this.seoul.eventsOn(d)));
			for (const b of batch) out.push(...b);
		}
		return out;
	}
}

function haystack(e: SeoulEvent): string {
	return [e.title, e.venue, e.address, e.district, e.district_ko, e.source_category, e.summary, ...(e.tags ?? []), ...e.categories]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
}

/** Chronological; events already running when the range starts sort on the first day, after that day's timed events. */
function sortKey(e: SeoulEvent, from: string): string {
	if (e._startDate < from) return `${from}T99`;
	return e.start.length === 10 ? `${e.start}T99` : e.start;
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
	return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
