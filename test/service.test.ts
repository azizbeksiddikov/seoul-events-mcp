import { describe, expect, it } from 'vitest';
import { makeService } from './helpers.js';

describe('SeoulEventsService.search', () => {
	it('defaults to the next 7 days and merges both sources chronologically', async () => {
		const { service } = makeService();
		const r = await service.search({ limit: 50 });
		expect(r.date_range).toEqual({ from: '2026-10-24', to: '2026-10-30', timezone: 'Asia/Seoul' });
		const ids = r.events.map((e) => e.id);
		expect(ids.some((i) => i.startsWith('eventify:'))).toBe(true);
		expect(ids.some((i) => i.startsWith('seoul:'))).toBe(true);
		expect(ids).not.toContain('eventify:6ad7b83abdb064f0ac221306'); // Busan event filtered
		const starts = r.events.filter((e) => e.start.length > 10).map((e) => e.start);
		expect([...starts].sort()).toEqual(starts);
		expect(r.sources.map((s) => s.status)).toEqual(['ok', 'ok']);
		expect(r.warnings.join(' ')).toMatch(/sample key/);
	});

	it('filters by district using neighborhoods and Korean names', async () => {
		const { service } = makeService();
		const r = await service.search({ district: 'Gangnam', date_from: '2026-10-24', date_to: '2026-10-25' });
		expect(r.events.length).toBeGreaterThan(0);
		expect(r.events.every((e) => e.district === 'Gangnam-gu')).toBe(true);
		const ko = await service.search({ district: '마포구', date_from: '2026-10-24', date_to: '2026-10-31' });
		expect(ko.events.map((e) => e.title)).toContain('Food Discovery Fridays'); // "Hongdae" -> Mapo
	});

	it('filters by category and free_only', async () => {
		const { service } = makeService();
		const r = await service.search({ category: ['tech'], date_from: '2026-10-24', date_to: '2026-10-30' });
		expect(r.events.every((e) => e.categories.includes('tech'))).toBe(true);
		expect(r.sources.find((s) => s.id === 'seoul')?.status).toBe('skipped'); // no tech in culture portal
		const free = await service.search({ category: ['tech'], free_only: true, date_from: '2026-10-24', date_to: '2026-10-30' });
		expect(free.events.map((e) => e.title)).not.toContain('AWSKRUG #Seongsu (English-Friendly) - Kiro & AWS Agents');
		expect(free.events.every((e) => e.is_free === true)).toBe(true);
	});

	it('matches English keywords against Korean titles', async () => {
		const { service } = makeService();
		const r = await service.search({ query: 'ballet', date_from: '2026-10-25', date_to: '2026-10-25' });
		expect(r.events[0].title).toMatch(/발레/);
	});

	it('english_friendly excludes Korean-only talks', async () => {
		const { service } = makeService();
		const r = await service.search({ english_friendly: true, date_from: '2026-10-24', date_to: '2026-10-30', limit: 50 });
		expect(r.events.every((e) => e.english_friendly)).toBe(true);
		expect(r.events.map((e) => e.id)).not.toContain('eventify:6ad7b87ebdb064f0ac221280');
	});

	it('degrades gracefully when one source fails', async () => {
		const { service } = makeService({ failSeoul: true });
		const r = await service.search({});
		expect(r.events.length).toBeGreaterThan(0);
		expect(r.sources.find((s) => s.id === 'seoul')?.status).toBe('error');
		expect(r.warnings.join(' ')).toMatch(/Seoul Culture Portal is unavailable/);
	});

	it('surfaces Seoul API XML errors (e.g. bad key) as warnings', async () => {
		const { service } = makeService({ seoulXmlError: true, apiKey: 'bad-key' });
		const r = await service.search({ source: 'seoul' }).catch((e) => e);
		expect(String(r.message ?? r.warnings)).toMatch(/INFO-100/);
	});

	it('throws when every source fails', async () => {
		const { service } = makeService({ failSeoul: true, failEventify: true });
		await expect(service.search({})).rejects.toThrow(/All event sources failed/);
	});

	it('validates input with helpful messages', async () => {
		const { service } = makeService();
		await expect(service.search({ date_from: '2026-13-01' })).rejects.toThrow(/YYYY-MM-DD/);
		await expect(service.search({ date_from: '2026-11-02', date_to: '2026-11-01' })).rejects.toThrow(/before/);
		await expect(service.search({ date_from: '2026-11-01', date_to: '2026-12-31' })).rejects.toThrow(/maximum is 31/);
		await expect(service.search({ district: 'Atlantis' })).rejects.toThrow(/list_districts/);
	});

	it('uses the cache (no repeat upstream calls) and full page size with a real key', async () => {
		const { service, fetchFn } = makeService({ apiKey: 'test-key' });
		await service.search({ date_from: '2026-10-24', date_to: '2026-10-25' });
		const n = fetchFn.calls.length;
		await service.search({ date_from: '2026-10-24', date_to: '2026-10-25', query: 'party' });
		expect(fetchFn.calls.length).toBe(n);
		expect(fetchFn.calls.find((u) => u.includes('culturalEventInfo'))).toContain('/test-key/json/culturalEventInfo/1/1000/');
		expect(fetchFn.calls.filter((u) => u.includes('graphql')).every((u) => !/mutation/i.test(decodeURIComponent(u)))).toBe(true);
	});
});

describe('SeoulEventsService.getEvent', () => {
	it('returns Eventify details with a longer summary', async () => {
		const { service } = makeService();
		const e = await service.getEvent('eventify:6ad7b83abdb064f0ac221301');
		expect(e.title).toMatch(/AWSKRUG/);
		expect(e.summary).toMatch(/More details here/);
		expect(e.price).toBe('5,000 KRW');
	});
	it('resolves Seoul ids after a search and explains when not cached', async () => {
		const { service } = makeService();
		await expect(service.getEvent('seoul:159768')).rejects.toThrow(/search_events/);
		await service.search({ date_from: '2026-10-25', date_to: '2026-10-25' });
		expect((await service.getEvent('seoul:159768')).categories).toEqual(['traditional-music']);
	});
	it('rejects malformed and unknown ids', async () => {
		const { service } = makeService();
		await expect(service.getEvent('12345')).rejects.toThrow(/Invalid id/);
		await expect(service.getEvent('eventify:xyz')).rejects.toThrow(/not a valid/);
		await expect(service.getEvent('eventify:' + 'f'.repeat(24))).rejects.toThrow(/not found/);
	});
});
