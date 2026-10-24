/** Seoul's 25 districts (gu) with romanized names and well-known neighborhoods foreigners search for. */
export interface District {
	name: string; // e.g. "Gangnam-gu"
	base: string; // e.g. "gangnam"
	ko: string; // e.g. "강남구"
	neighborhoods: string[];
}

export const DISTRICTS: District[] = [
	{ name: 'Gangnam-gu', base: 'gangnam', ko: '강남구', neighborhoods: ['Yeoksam', 'Sinsa', 'Apgujeong', 'Cheongdam', 'Samseong', 'Nonhyeon', 'Daechi', 'Garosu-gil', 'COEX', 'Teheran-ro', 'Dosan-daero'] },
	{ name: 'Gangdong-gu', base: 'gangdong', ko: '강동구', neighborhoods: ['Cheonho', 'Gildong', 'Godeok', 'Amsa'] },
	{ name: 'Gangbuk-gu', base: 'gangbuk', ko: '강북구', neighborhoods: ['Suyu', 'Mia', 'Ui-dong'] },
	{ name: 'Gangseo-gu', base: 'gangseo', ko: '강서구', neighborhoods: ['Magok', 'Balsan', 'Hwagok', 'Gimpo Airport'] },
	{ name: 'Gwanak-gu', base: 'gwanak', ko: '관악구', neighborhoods: ['Sillim', 'Bongcheon', 'Seoul National University', 'Nakseongdae'] },
	{ name: 'Gwangjin-gu', base: 'gwangjin', ko: '광진구', neighborhoods: ['Konkuk', 'Kondae', 'Guui', 'Jayang', "Children's Grand Park"] },
	{ name: 'Guro-gu', base: 'guro', ko: '구로구', neighborhoods: ['Sindorim', 'Guro Digital Complex', 'Gocheok Sky Dome'] },
	{ name: 'Geumcheon-gu', base: 'geumcheon', ko: '금천구', neighborhoods: ['Gasan', 'Doksan', 'Siheung-dong'] },
	{ name: 'Nowon-gu', base: 'nowon', ko: '노원구', neighborhoods: ['Sanggye', 'Junggye', 'Hagye', 'Gongneung'] },
	{ name: 'Dobong-gu', base: 'dobong', ko: '도봉구', neighborhoods: ['Ssangmun', 'Chang-dong', 'Banghak', 'Dobongsan'] },
	{ name: 'Dongdaemun-gu', base: 'dongdaemun', ko: '동대문구', neighborhoods: ['Hoegi', 'Cheongnyangni', 'Kyung Hee University', 'Jegi-dong'] },
	{ name: 'Dongjak-gu', base: 'dongjak', ko: '동작구', neighborhoods: ['Noryangjin', 'Sadang', 'Heukseok', 'Daebang'] },
	{ name: 'Mapo-gu', base: 'mapo', ko: '마포구', neighborhoods: ['Hongdae', 'Hapjeong', 'Mangwon', 'Yeonnam', 'Sangsu', 'Seogyo', 'Gongdeok', 'Sangam', 'Yanghwa-ro', '서교동', '합정', '홍대', '연남'] },
	{ name: 'Seodaemun-gu', base: 'seodaemun', ko: '서대문구', neighborhoods: ['Sinchon', 'Yonsei', 'Ewha', 'Edae', 'Yeonhui', '신촌'] },
	{ name: 'Seocho-gu', base: 'seocho', ko: '서초구', neighborhoods: ['Banpo', 'Yangjae', 'Seoul Arts Center', 'Bangbae', 'Express Bus Terminal'] },
	{ name: 'Seongdong-gu', base: 'seongdong', ko: '성동구', neighborhoods: ['Seongsu', 'Wangsimni', 'Oksu', 'Seoul Forest', '성수'] },
	{ name: 'Seongbuk-gu', base: 'seongbuk', ko: '성북구', neighborhoods: ['Anam', 'Korea University', 'Jeongneung', 'Gireum'] },
	{ name: 'Songpa-gu', base: 'songpa', ko: '송파구', neighborhoods: ['Jamsil', 'Lotte World', 'Olympic Park', 'Garak', 'Munjeong', 'Seokchon', '잠실'] },
	{ name: 'Yangcheon-gu', base: 'yangcheon', ko: '양천구', neighborhoods: ['Mokdong', 'Mok-dong', 'Sinjeong'] },
	{ name: 'Yeongdeungpo-gu', base: 'yeongdeungpo', ko: '영등포구', neighborhoods: ['Yeouido', 'Mullae', 'Dangsan', 'The Hyundai Seoul', '여의도'] },
	{ name: 'Yongsan-gu', base: 'yongsan', ko: '용산구', neighborhoods: ['Itaewon', 'Hannam', 'Haebangchon', 'HBC', 'Ichon', 'Gyeongnidan', 'Noksapyeong', 'Namsan Tower', '이태원', '한남'] },
	{ name: 'Eunpyeong-gu', base: 'eunpyeong', ko: '은평구', neighborhoods: ['Bulgwang', 'Yeonsinnae', 'Gupabal', 'Jingwan'] },
	{ name: 'Jongno-gu', base: 'jongno', ko: '종로구', neighborhoods: ['Insadong', 'Insa-dong', 'Gwanghwamun', 'Bukchon', 'Ikseon', 'Hyehwa', 'Daehangno', 'Daehak-ro', 'Changsin', 'Samcheong', 'Gyeongbokgung', 'Seochon', '인사동', '광화문', '대학로'] },
	{ name: 'Jung-gu', base: 'jung', ko: '중구', neighborhoods: ['Myeongdong', 'Myeong-dong', 'Euljiro', 'DDP', 'Dongdaemun Design Plaza', 'Chungmuro', 'Namdaemun', 'Seoul City Hall', 'Sindang', '명동', '을지로'] },
	{ name: 'Jungnang-gu', base: 'jungnang', ko: '중랑구', neighborhoods: ['Sangbong', 'Myeonmok', 'Mangu'] },
];

function esc(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Matcher {
	d: District;
	strong: RegExp;
	weak: RegExp | null;
}

const MATCHERS: Matcher[] = DISTRICTS.map((d) => {
	const latin = d.neighborhoods.filter((n) => /^[\x00-\x7F]+$/.test(n));
	const hangul = d.neighborhoods.filter((n) => !/^[\x00-\x7F]+$/.test(n));
	const strong = new RegExp(`\\b${d.base}(?:-gu|\\s+gu|\\s+district)\\b|${d.ko}`, 'i');
	const weakParts = latin.map((n) => `\\b${esc(n)}\\b`).concat(hangul.map(esc));
	// A bare "Gangnam" / "Mapo" also counts as weak evidence (except the ambiguous "Jung").
	if (d.base !== 'jung') weakParts.unshift(`\\b${d.base}\\b`);
	return { d, strong, weak: weakParts.length ? new RegExp(weakParts.join('|'), 'i') : null };
});

/** Infer a district from free text (address, venue, title). Strong matches (explicit "-gu") win over neighborhoods. */
export function inferDistrict(...texts: Array<string | null | undefined>): District | undefined {
	const text = texts.filter(Boolean).join(' | ');
	if (!text) return undefined;
	for (const m of MATCHERS) if (m.strong.test(text)) return m.d;
	for (const m of MATCHERS) if (m.weak?.test(text)) return m.d;
	return undefined;
}

export function districtByKo(ko: string): District | undefined {
	return DISTRICTS.find((d) => d.ko === ko.trim());
}

/** Resolve user input like "gangnam", "Gangnam-gu", "강남구" or "Hongdae" to a district. */
export function resolveDistrict(input: string): District | undefined {
	const q = input.trim().toLowerCase();
	if (!q) return undefined;
	const exact = DISTRICTS.find(
		(d) => d.base === q || d.name.toLowerCase() === q || d.ko === q || `${d.base} gu` === q || `${d.base} district` === q,
	);
	return exact ?? inferDistrict(input);
}
