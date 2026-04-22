import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';
import type { CitationData } from './types';

marked.setOptions({
	gfm: true,
	// Don't treat single newlines as <br> — they render ugly <br>s inside fenced
	// code blocks and long paragraphs.
	breaks: false
});

/**
 * Turn `[c:N]` tokens into either:
 *   - a small superscript link to the article URL (podcast YouTube or
 *     newsletter post URL) if we have one, OR
 *   - nothing at all. We deliberately don't render chunk anchors — the
 *     chunk is internal plumbing, the article is the real source.
 *
 * Tokens are pulled out before markdown parsing (so digits/punctuation
 * aren't interpreted as markdown syntax), then re-injected afterwards.
 * The final HTML is DOMPurified as defense-in-depth against any tag that
 * slipped through the model's output.
 */
export function renderMarkdown(text: string, citations: CitationData[] = []): string {
	if (!text) return '';

	const byId = new Map<number, CitationData>(
		citations.map((c) => [Number(c.chunk_id), c])
	);

	const placeholderMap = new Map<string, number>();
	let i = 0;
	const placeheld = text.replace(/\[c:(\d+)\]/g, (_, id) => {
		const key = `xxCITExx${i}xxCITExx`;
		placeholderMap.set(key, Number.parseInt(id));
		i++;
		return key;
	});

	let html = marked.parse(placeheld, { async: false }) as string;

	for (const [key, id] of placeholderMap) {
		html = html.replaceAll(key, citationBadge(byId.get(id)));
	}

	return sanitize(html);
}

/**
 * Public rendering path for the chat-detail page etc. where we hydrate
 * stored citations once per message and want a stable DOMPurify call.
 */
export function renderPlainMarkdown(text: string): string {
	if (!text) return '';
	const html = marked.parse(text, { async: false }) as string;
	return sanitize(html);
}

function citationBadge(cite: CitationData | undefined): string {
	// No source URL? Drop the citation entirely. Chunk anchors are an
	// implementation detail we don't want leaking into the UI.
	if (!cite || !cite.source_url) return '';

	const url = cite.source_url;
	const label = buildTooltip(cite);
	const safeUrl = escapeAttr(url);
	const safeLabel = escapeAttr(label);

	// Small discreet ↗ superscript. Users who care click; users who don't, don't
	// see visual clutter. Article URL opens in a new tab.
	return (
		`<a class="cite" href="${safeUrl}" target="_blank" rel="noopener noreferrer"` +
		` title="${safeLabel}" aria-label="${safeLabel}">↗</a>`
	);
}

function buildTooltip(c: CitationData): string {
	const parts: string[] = [];
	if (c.speaker) parts.push(c.speaker);
	if (c.title) parts.push(`"${c.title}"`);
	if (c.date) parts.push(c.date);
	if (c.timestamp_str) parts.push(`@ ${c.timestamp_str}`);
	return parts.join(' — ') || 'Source';
}

function escapeAttr(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/**
 * DOMPurify works in both SSR (jsdom/happy-dom fallback) and browser.
 * We allow only http(s) URLs in href, so the citation links can't become
 * javascript: / data: payloads.
 */
function sanitize(html: string): string {
	return DOMPurify.sanitize(html, {
		ALLOWED_ATTR: [
			'href',
			'title',
			'class',
			'target',
			'rel',
			'aria-label',
			'data-chunk'
		],
		ALLOWED_URI_REGEXP: /^(?:https?|mailto|#):/i,
		ADD_ATTR: ['target', 'rel']
	});
}
