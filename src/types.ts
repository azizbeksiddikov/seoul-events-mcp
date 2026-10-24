import type { CategoryId } from './data/categories.js';

export type SourceId = 'eventify' | 'seoul';

/** One event, normalized across sources. Field names and values are English; original Korean text is kept. */
export interface SeoulEvent {
	id: string;
	title: string;
	/** Original Korean title when the source title is Korean. */
	title_ko?: string;
	/** Language of the original title. */
	title_language: 'en' | 'ko' | 'mixed';
	categories: CategoryId[];
	/** Original category label from the source (e.g. "전시/미술" or "TECHNOLOGY"). */
	source_category?: string;
	/** Start: ISO date-time in KST when known, otherwise YYYY-MM-DD. */
	start: string;
	end: string;
	/** Free-text schedule from the source (e.g. "Tue 19:30"). */
	time_note?: string;
	district?: string;
	district_ko?: string;
	venue?: string;
	address?: string;
	online: boolean;
	/** null = unknown */
	is_free: boolean | null;
	price?: string;
	audience?: string;
	english_friendly: boolean;
	english_note: string;
	url?: string;
	image?: string;
	summary?: string;
	tags?: string[];
	source: { id: SourceId; name: string; attribution: string; origin?: string };
	/** Internal: KST calendar dates used for filtering. Not part of tool output. */
	_startDate: string;
	_endDate: string;
}

export type PublicEvent = Omit<SeoulEvent, '_startDate' | '_endDate'>;

export function toPublic(e: SeoulEvent): PublicEvent {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { _startDate, _endDate, ...rest } = e;
	return rest;
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class UserInputError extends Error {}
export class UpstreamError extends Error {}
