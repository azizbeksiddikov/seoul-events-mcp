const HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/g;
const LATIN = /[A-Za-z]/g;

export function hasHangul(s: string): boolean {
	return /[가-힯]/.test(s);
}

export function titleLanguage(title: string): 'en' | 'ko' | 'mixed' {
	const ko = (title.match(HANGUL) ?? []).length;
	const en = (title.match(LATIN) ?? []).length;
	if (ko === 0) return 'en';
	if (en === 0 || ko >= en) return 'ko';
	return 'mixed';
}

/** Markdown/HTML to plain text, trimmed to maxLen characters at a word boundary. */
export function plainSummary(text: string | null | undefined, maxLen: number): string | undefined {
	if (!text) return undefined;
	const plain = text
		.replace(/<[^>]+>/g, ' ')
		.replace(/!\[[^\]]*]\([^)]*\)/g, '')
		.replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
		.replace(/[*_#>`~]+/g, '')
		.replace(/\\/g, '')
		.replace(/[-]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!plain) return undefined;
	if (plain.length <= maxLen) return plain;
	const cut = plain.slice(0, maxLen);
	const lastSpace = cut.lastIndexOf(' ');
	return `${(lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * Small English -> Korean glossary so English searches also hit Korean-only titles
 * from the Seoul Culture Portal (e.g. "jazz" finds "재즈").
 */
export const SYNONYMS: Record<string, string[]> = {
	jazz: ['재즈'],
	piano: ['피아노'],
	violin: ['바이올린'],
	orchestra: ['오케스트라', '관현악'],
	choir: ['합창'],
	opera: ['오페라'],
	musical: ['뮤지컬'],
	ballet: ['발레'],
	dance: ['무용', '댄스'],
	theater: ['연극'],
	theatre: ['연극'],
	play: ['연극'],
	film: ['영화'],
	movie: ['영화'],
	cinema: ['영화'],
	exhibition: ['전시'],
	art: ['미술', '아트'],
	photo: ['사진'],
	photography: ['사진'],
	festival: ['축제', '페스티벌'],
	concert: ['콘서트', '공연'],
	music: ['음악'],
	traditional: ['전통', '국악'],
	gugak: ['국악'],
	hanbok: ['한복'],
	kids: ['어린이', '아동', '가족'],
	children: ['어린이', '아동'],
	family: ['가족'],
	book: ['책', '도서'],
	library: ['도서관'],
	lecture: ['강연', '특강'],
	workshop: ['워크숍', '체험'],
	market: ['마켓', '장터'],
	lantern: ['등불', '등축제', '연등'],
	christmas: ['크리스마스'],
	halloween: ['할로윈', '핼러윈'],
	autumn: ['가을'],
	night: ['야간', '밤'],
	free: ['무료'],
	palace: ['궁'],
	hiking: ['등산'],
};

/** Lower-cased search terms, each expanded with Korean synonyms. */
export function queryTerms(query: string): string[][] {
	return query
		.toLowerCase()
		.split(/[\s,]+/)
		.map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
		.filter((t) => t.length > 1 && !STOPWORDS.has(t))
		.map((t) => [t, ...(SYNONYMS[t] ?? []), ...(t.endsWith('s') ? (SYNONYMS[t.slice(0, -1)] ?? []) : [])]);
}

const STOPWORDS = new Set(['the', 'and', 'or', 'in', 'at', 'on', 'for', 'of', 'a', 'an', 'to', 'event', 'events', 'seoul', 'this', 'with']);
