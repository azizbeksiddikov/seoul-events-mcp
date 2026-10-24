import { describe, expect, it } from 'vitest';
import { TtlCache } from '../src/cache.js';
import { categoryFromEventify, categoryFromSeoul } from '../src/data/categories.js';
import { inferDistrict, resolveDistrict } from '../src/data/districts.js';
import { normalizeEventifyEvent, isInSeoulArea } from '../src/sources/eventify.js';
import { normalizeSeoulRow } from '../src/sources/seoul.js';
import { plainSummary, queryTerms, titleLanguage } from '../src/text.js';
import { isIsoDate, kstDate, kstIso, weekendRange } from '../src/time.js';
import fixture from './fixtures/seoul-2026-10-25.json' with { type: 'json' };

describe('time (KST)', () => {
	it('converts instants to Seoul dates across midnight', () => {
		expect(kstDate(new Date('2026-10-24T15:30:00Z'))).toBe('2026-10-25');
		expect(kstIso(new Date('2026-10-24T09:50:00Z'))).toBe('2026-10-24T18:50:00+09:00');
	});
	it('validates real dates only', () => {
		expect(isIsoDate('2026-02-29')).toBe(false);
		expect(isIsoDate('2028-02-29')).toBe(true);
		expect(isIsoDate('26-10-01')).toBe(false);
	});
	it('computes the weekend', () => {
		expect(weekendRange(new Date('2026-10-21T03:00:00Z'))).toEqual({ from: '2026-10-24', to: '2026-10-25' }); // Wed
		expect(weekendRange(new Date('2026-10-24T03:00:00Z'))).toEqual({ from: '2026-10-24', to: '2026-10-25' }); // Sat
		expect(weekendRange(new Date('2026-10-25T03:00:00Z'))).toEqual({ from: '2026-10-25', to: '2026-10-25' }); // Sun
		expect(weekendRange(new Date('2026-10-23T16:00:00Z'))).toEqual({ from: '2026-10-24', to: '2026-10-25' }); // Fri 23:00 UTC = Sat KST
	});
});

describe('districts', () => {
	it('resolves English, Korean and neighborhood names', () => {
		expect(resolveDistrict('gangnam')?.name).toBe('Gangnam-gu');
		expect(resolveDistrict('Mapo-gu')?.name).toBe('Mapo-gu');
		expect(resolveDistrict('종로구')?.name).toBe('Jongno-gu');
		expect(resolveDistrict('Hongdae')?.name).toBe('Mapo-gu');
		expect(resolveDistrict('itaewon')?.name).toBe('Yongsan-gu');
		expect(resolveDistrict('Jung-gu')?.name).toBe('Jung-gu');
		expect(resolveDistrict('Atlantis')).toBeUndefined();
	});
	it('infers districts from messy addresses, preferring explicit -gu', () => {
		expect(inferDistrict('FuriosaAI, 145 Dosan-daero, 신사동 Gangnam District, Seoul')?.name).toBe('Gangnam-gu');
		expect(inferDistrict('B1, 362-14 서교동 마포구 서울특별시')?.name).toBe('Mapo-gu');
		expect(inferDistrict('Seoul Yongsan-gu Itaewon-dong 116-15')?.name).toBe('Yongsan-gu');
		expect(inferDistrict('Jungnang-gu office')?.name).toBe('Jungnang-gu');
		expect(inferDistrict('Online event')).toBeUndefined();
	});
});

describe('categories', () => {
	it('maps both vocabularies', () => {
		expect(categoryFromSeoul('전시/미술')).toBe('exhibition-art');
		expect(categoryFromSeoul('축제-새로운분류')).toBe('festival');
		expect(categoryFromSeoul('독주/독창회')).toBe('classical');
		expect(categoryFromEventify('TECHNOLOGY')).toBe('tech');
		expect(categoryFromEventify('RELIGION')).toBe('other');
	});
});

describe('text', () => {
	it('detects title language', () => {
		expect(titleLanguage('Weekly Startup Night')).toBe('en');
		expect(titleLanguage('제21회 박지윤 가야금 독주회')).toBe('ko');
		expect(titleLanguage('AWSKRUG 소모임 - AI Engineering agents meetup')).toBe('mixed');
	});
	it('expands English terms with Korean synonyms', () => {
		expect(queryTerms('Jazz concerts in Seoul')).toEqual([['jazz', '재즈'], ['concerts', '콘서트', '공연']]);
	});
	it('strips markdown and truncates', () => {
		const s = plainSummary('# Hi\n\n**bold** [link](http://x) ' + 'word '.repeat(100), 50)!;
		expect(s.startsWith('Hi bold link')).toBe(true);
		expect(s.length).toBeLessThanOrEqual(51);
		expect(s.endsWith('…')).toBe(true);
	});
});

describe('normalization', () => {
	it('normalizes a Seoul Culture Portal row', () => {
		const row = (fixture as any).culturalEventInfo.row.find((r: any) => r.CODENAME === '국악');
		const e = normalizeSeoulRow(row);
		expect(e.id).toBe('seoul:159768');
		expect(e.categories).toEqual(['traditional-music']);
		expect(e.district).toBe('Gangnam-gu');
		expect(e.title_ko).toBe(row.TITLE);
		expect(e.is_free).toBe(false);
		expect(e.english_friendly).toBe(true); // non-verbal music
		expect(e.source.attribution).toMatch(/Seoul Open Data/);
		expect(e.start).toBe('2026-10-25');
	});
	it('normalizes an Eventify event to KST and detects online / free', () => {
		const e = normalizeEventifyEvent({
			_id: 'a'.repeat(24), eventName: 'Talk', eventStartAt: '2026-11-01T04:00:00.000Z', eventEndAt: '2026-11-01T05:00:00.000Z',
			locationType: 'OFFLINE', eventAddress: 'Online event', eventPrice: 0, eventCategories: ['HEALTH'], eventTags: [], origin: 'meetup.com', eventImages: [],
		});
		expect(e.start).toBe('2026-11-01T13:00:00+09:00');
		expect(e.online).toBe(true);
		expect(e.is_free).toBe(true);
		expect(e.categories).toEqual(['health']);
		expect(e.source.name).toBe('Eventify (Meetup)');
	});
	it('drops events clearly outside Seoul', () => {
		const base = { _id: 'b'.repeat(24), eventStartAt: '', eventEndAt: '', locationType: 'OFFLINE' as const, eventPrice: 0, eventCategories: [], eventTags: [], origin: 'x', eventImages: [] };
		expect(isInSeoulArea({ ...base, eventName: 'OWASP 부산 보안 데이', eventAddress: '' })).toBe(false);
		expect(isInSeoulArea({ ...base, eventName: 'Busan trip from Seoul', eventAddress: 'Seoul Station' })).toBe(true);
	});
});

describe('TtlCache', () => {
	it('expires entries and de-duplicates in-flight calls', async () => {
		let t = 0;
		const c = new TtlCache(1000, () => t);
		let calls = 0;
		const fn = async () => ++calls;
		const [a, b] = await Promise.all([c.wrap('k', fn), c.wrap('k', fn)]);
		expect([a, b, calls]).toEqual([1, 1, 1]);
		t = 999;
		expect(await c.wrap('k', fn)).toBe(1);
		t = 1001;
		expect(await c.wrap('k', fn)).toBe(2);
	});
	it('does not cache errors', async () => {
		const c = new TtlCache(1000);
		await expect(c.wrap('e', async () => { throw new Error('x'); })).rejects.toThrow('x');
		expect(await c.wrap('e', async () => 'ok')).toBe('ok');
	});
});
