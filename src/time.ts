/** Date helpers. All calendar dates are Korea Standard Time (UTC+9, no DST). */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
	if (!DATE_RE.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Calendar date (YYYY-MM-DD) in Seoul for an instant. */
export function kstDate(instant: Date): string {
	return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO timestamp rendered in Seoul time, e.g. 2026-10-24T18:50:00+09:00 */
export function kstIso(instant: Date): string {
	return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19) + '+09:00';
}

export function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function eachDay(from: string, to: string): string[] {
	const out: string[] = [];
	for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
	return out;
}

/** 0 = Sunday ... 6 = Saturday, for a YYYY-MM-DD date. */
export function weekday(date: string): number {
	return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The current weekend if today (in Seoul) is Sat/Sun, otherwise the coming one. */
export function weekendRange(now: Date): { from: string; to: string } {
	const today = kstDate(now);
	const wd = weekday(today);
	if (wd === 6) return { from: today, to: addDays(today, 1) };
	if (wd === 0) return { from: today, to: today };
	const sat = addDays(today, 6 - wd);
	return { from: sat, to: addDays(sat, 1) };
}
