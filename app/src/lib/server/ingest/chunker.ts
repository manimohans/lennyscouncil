import { createHash } from 'node:crypto';
import { normalizeSpeaker, HOST_CANONICAL } from './speaker-normalizer';

export interface ChunkInput {
	source_file: string;
	source_type: 'podcast' | 'newsletter';
	speaker: string;
	title: string;
	date: string;
	tags: string[];
	text: string;
	source_url?: string;
	timestamp_str?: string;
	heading_trail?: string;
}

export interface Chunk extends ChunkInput {
	content_hash: string;
	token_count: number;
}

const SHORT_TURN_WORDS = 40;
const MAX_TURN_WORDS = 800;
const SUB_CHUNK_TARGET_WORDS = 400;
const NEWSLETTER_TARGET_WORDS = 600;
const NEWSLETTER_MAX_WORDS = 900;
// Hard ceiling — empirically the embedding model rejects chunks above ~4500 chars
// even with num_ctx raised. We cap below that with margin.
const MAX_CHUNK_CHARS = 3800;

// Two patterns observed in the corpus:
//   - Newer episodes: `**Speaker** (HH:MM:SS):` (timestamp present)
//   - Older episodes: `**Speaker**:` (no timestamp)
const SPEAKER_TURN_RE = /^\*\*([^*]+?)\*\*(?:\s*\((\d{2}:\d{2}:\d{2})\))?:\s*/m;
const SPEAKER_TURN_RE_GLOBAL = /^\*\*([^*]+?)\*\*(?:\s*\((\d{2}:\d{2}:\d{2})\))?:\s*/gm;

function approxTokens(text: string): number {
	// Rough approximation: 1 token ≈ 4 chars for English. Good enough for budgeting.
	return Math.ceil(text.length / 4);
}

function wordCount(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

function hashContent(parts: string[]): string {
	const h = createHash('sha256');
	for (const p of parts) h.update(p).update('\n');
	return h.digest('hex');
}

function makeChunk(input: ChunkInput): Chunk {
	return {
		...input,
		content_hash: hashContent([
			input.source_file,
			input.speaker,
			input.timestamp_str ?? input.heading_trail ?? '',
			input.text
		]),
		token_count: approxTokens(input.text)
	};
}

// Split a single very-long monologue into ~SUB_CHUNK_TARGET_WORDS sub-chunks.
// Also enforces MAX_CHUNK_CHARS as a hard ceiling.
function subSplit(text: string, target = SUB_CHUNK_TARGET_WORDS): string[] {
	const words = text.split(/\s+/);
	if (words.length <= target * 1.5 && text.length <= MAX_CHUNK_CHARS) return [text];

	const chunks: string[] = [];
	let cur: string[] = [];
	let curLen = 0;
	let curWords = 0;

	for (const w of words) {
		const addLen = w.length + (cur.length > 0 ? 1 : 0);
		if ((curWords >= target && curLen > 0) || curLen + addLen > MAX_CHUNK_CHARS) {
			chunks.push(cur.join(' '));
			cur = [];
			curLen = 0;
			curWords = 0;
		}
		cur.push(w);
		curLen += addLen;
		curWords += 1;
	}
	if (cur.length > 0) chunks.push(cur.join(' '));
	return chunks;
}

// Final-pass guard: any chunk that still exceeds MAX_CHUNK_CHARS gets word-level split.
function enforceCharCap(chunks: Chunk[]): Chunk[] {
	const out: Chunk[] = [];
	for (const c of chunks) {
		if (c.text.length <= MAX_CHUNK_CHARS) {
			out.push(c);
			continue;
		}
		const pieces = subSplit(c.text);
		for (let i = 0; i < pieces.length; i++) {
			out.push(
				makeChunk({
					...c,
					text: pieces[i],
					timestamp_str: c.timestamp_str ? `${c.timestamp_str}+${i}` : undefined,
					heading_trail: c.heading_trail
						? `${c.heading_trail} (split ${i + 1}/${pieces.length})`
						: undefined
				})
			);
		}
	}
	return out;
}

interface PodcastFrontmatter {
	title: string;
	date: string;
	tags: string[];
	guest: string;
	youtube_url?: string;
}

export function chunkPodcast(
	source_file: string,
	body: string,
	fm: PodcastFrontmatter
): Chunk[] {
	const matches = [...body.matchAll(SPEAKER_TURN_RE_GLOBAL)];
	if (matches.length === 0) return [];

	interface RawTurn {
		speaker: string;
		timestamp?: string;
		text: string;
	}
	const rawTurns: RawTurn[] = [];
	for (let i = 0; i < matches.length; i++) {
		const m = matches[i];
		const start = (m.index ?? 0) + m[0].length;
		const end = i + 1 < matches.length ? (matches[i + 1].index ?? body.length) : body.length;
		const text = body.slice(start, end).trim();
		if (!text) continue;
		rawTurns.push({ speaker: m[1].trim(), timestamp: m[2], text });
	}

	// Pass 1: filter non-speech, normalize speaker names
	const cleaned = rawTurns
		.map((t) => {
			const norm = normalizeSpeaker(t.speaker);
			if (norm.isNonSpeech) return null;
			return { ...t, speaker: norm.canonical };
		})
		.filter((t): t is RawTurn => t !== null);

	// Pass 2: merge short turns into the next turn (preserve attribution of the "merge target")
	// We only merge into the next turn if the speakers are different — short interjections.
	// If the same speaker has a short turn, it stays attached to their next turn.
	const merged: RawTurn[] = [];
	for (let i = 0; i < cleaned.length; i++) {
		const t = cleaned[i];
		if (wordCount(t.text) < SHORT_TURN_WORDS && i + 1 < cleaned.length) {
			// Prepend to the NEXT turn, keeping next turn's speaker + timestamp
			cleaned[i + 1] = {
				...cleaned[i + 1],
				text: `[${t.speaker}: ${t.text}] ${cleaned[i + 1].text}`
			};
			continue;
		}
		merged.push(t);
	}

	// Pass 3: sub-split long monologues
	const chunks: Chunk[] = [];
	for (const t of merged) {
		const wc = wordCount(t.text);
		const pieces = wc > MAX_TURN_WORDS ? subSplit(t.text) : [t.text];
		for (let pi = 0; pi < pieces.length; pi++) {
			chunks.push(
				makeChunk({
					source_file,
					source_type: 'podcast',
					speaker: t.speaker,
					title: fm.title,
					date: fm.date,
					tags: fm.tags,
					text: pieces[pi],
					source_url: fm.youtube_url,
					timestamp_str: t.timestamp
						? pieces.length > 1
							? `${t.timestamp}+${pi}`
							: t.timestamp
						: undefined
				})
			);
		}
	}

	return enforceCharCap(chunks);
}

interface NewsletterFrontmatter {
	title: string;
	date: string;
	tags: string[];
	post_url?: string;
}

interface HeadingSection {
	trail: string;
	text: string;
}

function splitNewsletterByHeadings(body: string): HeadingSection[] {
	const lines = body.split('\n');
	const sections: HeadingSection[] = [];
	let h2 = '';
	let h3 = '';
	let buf: string[] = [];
	let trail = '';

	const flush = () => {
		const text = buf.join('\n').trim();
		if (text) sections.push({ trail, text });
		buf = [];
	};

	for (const line of lines) {
		const h2m = /^##\s+(.+?)\s*$/.exec(line);
		const h3m = /^###\s+(.+?)\s*$/.exec(line);
		const h1m = /^#\s+(.+?)\s*$/.exec(line);
		if (h1m || h2m || h3m) {
			flush();
			if (h1m) {
				h2 = '';
				h3 = '';
				trail = h1m[1];
			} else if (h2m) {
				h2 = h2m[1];
				h3 = '';
				trail = h2;
			} else if (h3m) {
				h3 = h3m[1];
				trail = h2 ? `${h2} › ${h3}` : h3;
			}
			continue;
		}
		buf.push(line);
	}
	flush();
	return sections.filter((s) => s.text.length > 0);
}

function splitParagraphs(text: string, target = NEWSLETTER_TARGET_WORDS, max = NEWSLETTER_MAX_WORDS): string[] {
	// First explode any paragraph that single-handedly exceeds `max` (e.g. code blocks, lists)
	const paras = text
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0)
		.flatMap((p) => (wordCount(p) > max ? subSplit(p, target) : [p]));

	const out: string[] = [];
	let cur: string[] = [];
	let curWords = 0;
	for (const p of paras) {
		const w = wordCount(p);
		if (curWords + w > max && cur.length > 0) {
			out.push(cur.join('\n\n'));
			cur = [];
			curWords = 0;
		}
		cur.push(p);
		curWords += w;
		if (curWords >= target) {
			out.push(cur.join('\n\n'));
			cur = [];
			curWords = 0;
		}
	}
	if (cur.length > 0) out.push(cur.join('\n\n'));
	return out;
}

export function chunkNewsletter(
	source_file: string,
	body: string,
	fm: NewsletterFrontmatter
): Chunk[] {
	const sections = splitNewsletterByHeadings(body);
	const chunks: Chunk[] = [];

	if (sections.length === 0 || (sections.length === 1 && sections[0].trail === '')) {
		// No headings — paragraph fallback
		const pieces = splitParagraphs(body);
		for (let i = 0; i < pieces.length; i++) {
			chunks.push(
				makeChunk({
					source_file,
					source_type: 'newsletter',
					speaker: HOST_CANONICAL,
					title: fm.title,
					date: fm.date,
					tags: fm.tags,
					text: pieces[i],
					source_url: fm.post_url,
					heading_trail: `(part ${i + 1}/${pieces.length})`
				})
			);
		}
		return enforceCharCap(chunks);
	}

	for (const section of sections) {
		const pieces = splitParagraphs(section.text);
		for (let i = 0; i < pieces.length; i++) {
			chunks.push(
				makeChunk({
					source_file,
					source_type: 'newsletter',
					speaker: HOST_CANONICAL,
					title: fm.title,
					date: fm.date,
					tags: fm.tags,
					text: pieces[i],
					source_url: fm.post_url,
					heading_trail:
						pieces.length > 1
							? `${section.trail || '(intro)'} (part ${i + 1}/${pieces.length})`
							: section.trail || '(intro)'
				})
			);
		}
	}

	return enforceCharCap(chunks);
}

export const _internal = { SPEAKER_TURN_RE, wordCount, subSplit, enforceCharCap, MAX_CHUNK_CHARS };
