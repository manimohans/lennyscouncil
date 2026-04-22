// Normalize speaker names captured from podcast transcripts.
// Verified corpus quirks (sampled 2026-04-21):
//   - Versioning suffixes: "Elena Verna 3.0", "Sherwin Wu V2", "Nikhyl Singhal 2", "Ethan Evans 2.0"
//   - Multi-guest podcasts use " + " in the file-level guest field; in-transcript names are single people
//   - Host appears as both "Lenny" and "Lenny Rachitsky" within the same episode
//   - Non-speech markers: "MUSIC", "SOUND EFFECT"
//   - Title-prefixed names: "Dr. Becky Kennedy"

const HOST_ALIASES = new Set(['lenny', 'lenny rachitsky']);
export const HOST_CANONICAL = 'Lenny Rachitsky';

const NON_SPEECH = new Set(['MUSIC', 'MUSIC PLAYING', 'SOUND', 'SFX', 'INTRO', 'OUTRO']);

const VERSION_SUFFIX_RE = /\s+(?:v\d+(?:\.\d+)?|\d+(?:\.\d+)?)$/i;

export interface NormalizedSpeaker {
	canonical: string;
	isHost: boolean;
	isNonSpeech: boolean;
}

export function normalizeSpeaker(raw: string): NormalizedSpeaker {
	const trimmed = raw.trim();

	if (NON_SPEECH.has(trimmed.toUpperCase())) {
		return { canonical: trimmed, isHost: false, isNonSpeech: true };
	}

	const stripped = trimmed.replace(VERSION_SUFFIX_RE, '').trim();

	if (HOST_ALIASES.has(stripped.toLowerCase())) {
		return { canonical: HOST_CANONICAL, isHost: true, isNonSpeech: false };
	}

	return { canonical: stripped, isHost: false, isNonSpeech: false };
}

// Split frontmatter "guest" field that uses " + " for multi-guest episodes
// e.g. "Aishwarya Naresh Reganti + Kiriti Badam" → ["Aishwarya Naresh Reganti", "Kiriti Badam"]
export function splitGuestField(guest: string): string[] {
	return guest
		.split(/\s+\+\s+/)
		.map((g) => normalizeSpeaker(g).canonical)
		.filter((g) => g.length > 0);
}

// Slugify a normalized name for URLs and dedup
export function slugifyName(name: string): string {
	return name
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}
