import { categoryFromEventify, type CategoryId } from '../data/categories.js';
import { inferDistrict } from '../data/districts.js';
import { titleLanguage, plainSummary } from '../text.js';
import { kstDate, kstIso } from '../time.js';
import type { FetchFn, SeoulEvent } from '../types.js';
import { UpstreamError, UserInputError } from '../types.js';
import type { TtlCache } from '../cache.js';

/** Fields of Eventify's public GraphQL `Event` type that we read. */
export interface EventifyEvent {
	_id: string;
	eventName: string;
	eventDesc?: string | null;
	eventStartAt: string;
	eventEndAt: string;
	locationType: 'ONLINE' | 'OFFLINE';
	eventCity?: string | null;
	eventAddress?: string | null;
	eventPrice: number;
	eventCurrency?: string | null;
	eventCategories: string[];
	eventTags: string[];
	eventStatus?: string;
	origin: string;
	externalUrl?: string | null;
	eventImages: string[];
}

const FIELDS =
	'_id eventName eventDesc eventStartAt eventEndAt locationType eventCity eventAddress eventPrice eventCurrency eventCategories eventTags eventStatus origin externalUrl eventImages';

const LIST_QUERY = `query($input: EventsInquiry!){ getEvents(input: $input){ list { ${FIELDS} } } }`;
const ONE_QUERY = `query($id: String!){ getEvent(eventId: $id){ ${FIELDS} } }`;

export const EVENTIFY_SITE = 'https://eventify.azbek.me';

export interface EventifySourceOptions {
	apiUrl?: string;
	fetchFn: FetchFn;
	cache: TtlCache;
	timeoutMs?: number;
}

/**
 * Eventify (eventify.azbek.me): English-first community events in Seoul — meetups, tech talks,
 * language exchanges — crawled from Meetup and Luma plus events created on Eventify itself.
 * Read-only: only GraphQL queries over HTTP GET, never mutations.
 */
export class EventifySource {
	private readonly apiUrl: string;

	constructor(private readonly opts: EventifySourceOptions) {
		this.apiUrl = opts.apiUrl?.trim() || `${EVENTIFY_SITE}/api/graphql`;
	}

	/** All upcoming + ongoing events (Eventify keeps ~a month ahead; a few dozen events). */
	async listActive(): Promise<SeoulEvent[]> {
		return this.opts.cache.wrap('eventify:active', async () => {
			const statuses = ['ONGOING', 'UPCOMING'];
			const lists = await Promise.all(
				statuses.map((eventStatus) =>
					this.query<{ getEvents: { list: EventifyEvent[] } }>(LIST_QUERY, {
						input: { page: 1, limit: 200, sort: 'eventStartAt', direction: 'ASC', search: { eventStatus } },
					}),
				),
			);
			const seen = new Set<string>();
			const out: SeoulEvent[] = [];
			for (const l of lists)
				for (const e of l.getEvents.list) {
					if (seen.has(e._id) || !isInSeoulArea(e)) continue;
					seen.add(e._id);
					out.push(normalizeEventifyEvent(e));
				}
			return out;
		});
	}

	async get(mongoId: string): Promise<SeoulEvent | undefined> {
		if (!/^[a-f0-9]{24}$/i.test(mongoId)) throw new UserInputError(`"eventify:${mongoId}" is not a valid Eventify event id.`);
		return this.opts.cache.wrap(`eventify:one:${mongoId}`, async () => {
			try {
				const data = await this.query<{ getEvent: EventifyEvent }>(ONE_QUERY, { id: mongoId });
				return normalizeEventifyEvent(data.getEvent, 1500);
			} catch (err) {
				if (err instanceof UpstreamError && /not.?found|no data/i.test(err.message)) return undefined;
				throw err;
			}
		});
	}

	private async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
		const url = `${this.apiUrl}?query=${encodeURIComponent(query)}&variables=${encodeURIComponent(JSON.stringify(variables))}`;
		let res: Response;
		try {
			res = await this.opts.fetchFn(url, {
				method: 'GET',
				headers: { Accept: 'application/json', 'apollo-require-preflight': 'true', 'User-Agent': 'seoul-events-mcp' },
				signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
			});
		} catch (err) {
			throw new UpstreamError(`Eventify API unreachable: ${(err as Error).message}`);
		}
		let json: { data?: T; errors?: Array<{ message: string }> };
		try {
			json = await res.json();
		} catch {
			throw new UpstreamError(`Eventify API HTTP ${res.status} (non-JSON response)`);
		}
		if (json.errors?.length) throw new UpstreamError(`Eventify API error: ${json.errors.map((e) => e.message).join('; ')}`);
		if (!res.ok || !json.data) throw new UpstreamError(`Eventify API HTTP ${res.status}`);
		return json.data;
	}
}

const OTHER_CITIES = /\b(busan|daegu|daejeon|gwangju|ulsan|jeju|tokyo|osaka)\b|부산|대구|대전|울산|제주/i;
const SEOUL = /seoul|서울/i;

/** Eventify is Seoul-focused but the crawl occasionally picks up events elsewhere in Korea. */
export function isInSeoulArea(e: EventifyEvent): boolean {
	const where = `${e.eventCity ?? ''} ${e.eventAddress ?? ''}`;
	if (SEOUL.test(where)) return true;
	return !OTHER_CITIES.test(`${where} ${e.eventName}`);
}

const ENGLISH_TAGS = /english|expat|international|foreigner|language exchange|global|new in town/i;

const ORIGIN_NAMES: Record<string, string> = {
	'meetup.com': 'Meetup',
	'luma.com': 'Luma',
	'lu.ma': 'Luma',
	internal: 'Eventify community',
};

export function normalizeEventifyEvent(e: EventifyEvent, summaryLen = 300): SeoulEvent {
	const start = new Date(e.eventStartAt);
	const end = new Date(e.eventEndAt || e.eventStartAt);
	const address = e.eventAddress?.trim() || undefined;
	const online = e.locationType === 'ONLINE' || /^online( event)?$/i.test(address ?? '');
	const district = online ? undefined : inferDistrict(address, e.eventCity, e.eventName);
	const lang = titleLanguage(e.eventName);
	const categories = [...new Set(e.eventCategories.map(categoryFromEventify))] as CategoryId[];
	const englishTagged = e.eventTags.some((t) => ENGLISH_TAGS.test(t)) || ENGLISH_TAGS.test(e.eventName);
	const english = lang === 'en' || englishTagged;
	const originName = ORIGIN_NAMES[e.origin] ?? e.origin;
	const isFree = typeof e.eventPrice === 'number' ? e.eventPrice === 0 : null;
	return {
		id: `eventify:${e._id}`,
		title: e.eventName,
		title_ko: lang === 'en' ? undefined : e.eventName,
		title_language: lang,
		categories: categories.length ? categories : ['other'],
		source_category: e.eventCategories.join(', ') || undefined,
		start: kstIso(start),
		end: kstIso(end),
		district: district?.name,
		district_ko: district?.ko,
		venue: online ? 'Online' : undefined,
		address: online ? undefined : address,
		online,
		is_free: isFree,
		price: isFree ? 'Free' : `${e.eventPrice.toLocaleString('en-US')} ${e.eventCurrency || 'KRW'}`,
		english_friendly: english,
		english_note: englishTagged
			? 'Tagged for internationals / English speakers.'
			: lang === 'en'
				? 'Listing is in English.'
				: 'Listing is mostly Korean.',
		url: e.externalUrl || `${EVENTIFY_SITE}/events/${e._id}`,
		image: e.eventImages?.[0],
		summary: plainSummary(e.eventDesc, summaryLen),
		tags: e.eventTags.length ? e.eventTags.slice(0, 10) : undefined,
		source: {
			id: 'eventify',
			name: `Eventify (${originName})`,
			attribution: `Eventify – ${EVENTIFY_SITE}${e.origin !== 'internal' ? `; originally listed on ${originName}` : ''}`,
			origin: e.origin,
		},
		_startDate: kstDate(start),
		_endDate: kstDate(end),
	};
}
