import { categoryFromSeoul, categoryInfo } from '../data/categories.js';
import { districtByKo } from '../data/districts.js';
import { titleLanguage, plainSummary } from '../text.js';
import type { FetchFn, SeoulEvent } from '../types.js';
import { UpstreamError } from '../types.js';
import type { TtlCache } from '../cache.js';

/** Row shape of Seoul Open Data `culturalEventInfo` (서울시 문화행사 정보). */
export interface SeoulRow {
	CODENAME: string;
	GUNAME: string;
	TITLE: string;
	DATE: string;
	PLACE: string;
	ORG_NAME: string;
	USE_TRGT: string;
	USE_FEE: string;
	PLAYER?: string;
	PROGRAM?: string;
	ETC_DESC?: string;
	ORG_LINK: string;
	MAIN_IMG: string;
	STRTDATE: string;
	END_DATE: string;
	IS_FREE: string;
	HMPG_ADDR: string;
	PRO_TIME?: string;
	LAT?: string;
	LOT?: string;
}

export const SEOUL_ATTRIBUTION =
	'Seoul Metropolitan Government, Seoul Open Data Plaza (data.seoul.go.kr) – culturalEventInfo, KOGL Type 1';

export interface SeoulSourceOptions {
	apiKey?: string;
	baseUrl?: string;
	fetchFn: FetchFn;
	cache: TtlCache;
	timeoutMs?: number;
}

const SAMPLE_KEY = 'sample';

export class SeoulCultureSource {
	readonly usingSampleKey: boolean;
	private readonly key: string;
	private readonly baseUrl: string;
	/** Everything seen so far, so get_event can resolve "seoul:<code>" ids. */
	private readonly index = new Map<string, SeoulEvent>();

	constructor(private readonly opts: SeoulSourceOptions) {
		this.key = opts.apiKey?.trim() || SAMPLE_KEY;
		this.usingSampleKey = this.key === SAMPLE_KEY;
		this.baseUrl = (opts.baseUrl ?? 'http://openapi.seoul.go.kr:8088').replace(/\/$/, '');
	}

	/** Max rows per request: the public sample key is capped at 5. */
	get pageSize(): number {
		return this.usingSampleKey ? 5 : 1000;
	}

	/** Events running on a given KST date (YYYY-MM-DD). */
	async eventsOn(date: string): Promise<SeoulEvent[]> {
		return this.opts.cache.wrap(`seoul:day:${date}:${this.pageSize}`, async () => {
			const url = `${this.baseUrl}/${encodeURIComponent(this.key)}/json/culturalEventInfo/1/${this.pageSize}/%20/%20/${date}`;
			const rows = await this.fetchRows(url);
			const events = rows.map(normalizeSeoulRow);
			for (const e of events) this.index.set(e.id, e);
			return events;
		});
	}

	lookup(id: string): SeoulEvent | undefined {
		return this.index.get(id);
	}

	private async fetchRows(url: string): Promise<SeoulRow[]> {
		let res: Response;
		try {
			res = await this.opts.fetchFn(url, {
				headers: { Accept: 'application/json', 'User-Agent': 'seoul-events-mcp' },
				signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
			});
		} catch (err) {
			throw new UpstreamError(`Seoul Open Data API unreachable: ${(err as Error).message}`);
		}
		const body = await res.text();
		if (!res.ok) throw new UpstreamError(`Seoul Open Data API HTTP ${res.status}`);
		// Errors come back as XML even when JSON is requested.
		if (body.trimStart().startsWith('<')) {
			const code = body.match(/<CODE>([^<]+)<\/CODE>/)?.[1] ?? 'UNKNOWN';
			if (code === 'INFO-200') return [];
			const msg = body.match(/<MESSAGE><!\[CDATA\[([\s\S]*?)]]><\/MESSAGE>/)?.[1] ?? body.match(/<MESSAGE>([^<]+)/)?.[1] ?? '';
			throw new UpstreamError(`Seoul Open Data API error ${code}: ${msg.trim().split('\n')[0]}`);
		}
		let json: any;
		try {
			json = JSON.parse(body);
		} catch {
			throw new UpstreamError('Seoul Open Data API returned invalid JSON');
		}
		const block = json.culturalEventInfo;
		const code: string | undefined = block?.RESULT?.CODE ?? json.RESULT?.CODE;
		if (code === 'INFO-200') return [];
		if (!block) throw new UpstreamError(`Seoul Open Data API error ${code ?? 'UNKNOWN'}: ${json.RESULT?.MESSAGE ?? ''}`);
		return Array.isArray(block.row) ? block.row : [];
	}
}

const FREE_KO = '무료';

function day(s: string | undefined): string {
	return (s ?? '').slice(0, 10);
}

export function normalizeSeoulRow(r: SeoulRow): SeoulEvent {
	const category = categoryFromSeoul(r.CODENAME ?? '');
	const district = districtByKo(r.GUNAME ?? '');
	const cultcode = r.HMPG_ADDR?.match(/cultcode=(\d+)/)?.[1];
	const start = day(r.STRTDATE) || day(r.DATE);
	const end = day(r.END_DATE) || start;
	const id = `seoul:${cultcode ?? hash(`${r.TITLE}|${start}|${r.PLACE}`)}`;
	const lang = titleLanguage(r.TITLE ?? '');
	const isFree = r.IS_FREE === FREE_KO ? true : r.IS_FREE ? false : null;
	const nonVerbal = categoryInfo(category).nonVerbal === true;
	const englishTitle = lang === 'en';
	const program = [r.PROGRAM, r.PLAYER ? `Performers: ${r.PLAYER}` : '', r.ETC_DESC].filter(Boolean).join(' · ');
	return {
		id,
		title: r.TITLE,
		title_ko: lang === 'en' ? undefined : r.TITLE,
		title_language: lang,
		categories: [category],
		source_category: r.CODENAME,
		start,
		end,
		time_note: r.PRO_TIME || undefined,
		district: district?.name,
		district_ko: r.GUNAME || undefined,
		venue: r.PLACE || undefined,
		online: false,
		is_free: isFree,
		price: isFree ? 'Free' : r.USE_FEE || undefined,
		audience: r.USE_TRGT || undefined,
		english_friendly: nonVerbal || englishTitle,
		english_note: nonVerbal
			? 'Non-verbal format (music, dance, art or festival): enjoyable without Korean. Listing text is Korean.'
			: englishTitle
				? 'Title is in English; check the event page for language.'
				: 'Listing and likely the event are in Korean.',
		url: r.ORG_LINK || r.HMPG_ADDR || undefined,
		image: r.MAIN_IMG || undefined,
		summary: plainSummary(program, 300),
		source: {
			id: 'seoul',
			name: 'Seoul Culture Portal (Seoul Open Data)',
			attribution: SEOUL_ATTRIBUTION,
			origin: r.HMPG_ADDR || undefined,
		},
		_startDate: start,
		_endDate: end,
	};
}

function hash(s: string): string {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
	return h.toString(36);
}
