/** One English category vocabulary for both sources. */
export const CATEGORY_IDS = [
	'concert',
	'classical',
	'traditional-music',
	'theater',
	'musical-opera',
	'dance',
	'film',
	'exhibition-art',
	'festival',
	'education',
	'tech',
	'business',
	'community',
	'food',
	'sports-outdoors',
	'health',
	'travel',
	'culture',
	'entertainment',
	'other',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

export interface CategoryInfo {
	id: CategoryId;
	label: string;
	/** Seoul Culture Portal labels (CODENAME) mapped here. */
	seoul: string[];
	/** Eventify enum values mapped here. */
	eventify: string[];
	/** Performances that need little or no Korean to enjoy. */
	nonVerbal?: boolean;
}

export const CATEGORIES: CategoryInfo[] = [
	{ id: 'concert', label: 'Concerts (pop, jazz, indie)', seoul: ['콘서트'], eventify: [], nonVerbal: true },
	{ id: 'classical', label: 'Classical music & recitals', seoul: ['클래식', '독주/독창회'], eventify: [], nonVerbal: true },
	{ id: 'traditional-music', label: 'Korean traditional music (gugak)', seoul: ['국악'], eventify: [], nonVerbal: true },
	{ id: 'theater', label: 'Theater & plays (usually in Korean)', seoul: ['연극'], eventify: [] },
	{ id: 'musical-opera', label: 'Musicals & opera', seoul: ['뮤지컬/오페라'], eventify: [] },
	{ id: 'dance', label: 'Dance & ballet', seoul: ['무용'], eventify: [], nonVerbal: true },
	{ id: 'film', label: 'Film screenings', seoul: ['영화'], eventify: [] },
	{ id: 'exhibition-art', label: 'Exhibitions & art', seoul: ['전시/미술'], eventify: ['ART'], nonVerbal: true },
	{
		id: 'festival',
		label: 'Festivals',
		seoul: ['축제-문화/예술', '축제-관광/체육', '축제-시민화합', '축제-자연/경관', '축제-전통/역사', '축제-기타'],
		eventify: [],
		nonVerbal: true,
	},
	{ id: 'education', label: 'Classes, workshops & hands-on experiences', seoul: ['교육/체험'], eventify: ['EDUCATION'] },
	{ id: 'tech', label: 'Tech meetups, AI & developer events', seoul: [], eventify: ['TECHNOLOGY'] },
	{ id: 'business', label: 'Business, startups & networking', seoul: [], eventify: ['BUSINESS'] },
	{ id: 'community', label: 'Community, social & language exchange', seoul: [], eventify: ['COMMUNITY'] },
	{ id: 'food', label: 'Food & drink', seoul: [], eventify: ['FOOD'] },
	{ id: 'sports-outdoors', label: 'Sports, hiking & outdoors', seoul: [], eventify: ['SPORTS'] },
	{ id: 'health', label: 'Health & wellness', seoul: [], eventify: ['HEALTH'] },
	{ id: 'travel', label: 'Travel & city tours', seoul: [], eventify: ['TRAVEL'] },
	{ id: 'culture', label: 'Culture (general)', seoul: [], eventify: ['CULTURE'] },
	{ id: 'entertainment', label: 'Parties & entertainment', seoul: [], eventify: ['ENTERTAINMENT'] },
	{ id: 'other', label: 'Other', seoul: ['기타'], eventify: ['POLITICS', 'RELIGION', 'OTHER'] },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryInfo(id: CategoryId): CategoryInfo {
	return BY_ID.get(id)!;
}

export function categoryFromSeoul(codename: string): CategoryId {
	const name = codename.trim();
	for (const c of CATEGORIES) if (c.seoul.includes(name)) return c.id;
	if (name.startsWith('축제')) return 'festival';
	return 'other';
}

export function categoryFromEventify(value: string): CategoryId {
	for (const c of CATEGORIES) if (c.eventify.includes(value)) return c.id;
	return 'other';
}
