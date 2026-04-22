import { marked } from 'marked';

marked.setOptions({
	gfm: true,
	breaks: true
});

/**
 * Render markdown to HTML with [c:NNN] citations transformed into clickable badges.
 *
 * Citations are extracted BEFORE markdown parsing (so the digits/punctuation
 * inside them aren't interpreted as markdown), then re-injected as <a class="cite">
 * after rendering.
 *
 * Sanitization note: content originates from our own LLM (not user input) and is
 * stored in our own DB. We rely on marked's default escaping for safety.
 */
export function renderMarkdown(text: string): string {
	if (!text) return '';
	const placeholderMap = new Map<string, number>();
	let i = 0;
	// Placeholder must contain no markdown-active chars (no _ * ` [ ]).
	const placeheld = text.replace(/\[c:(\d+)\]/g, (_, id) => {
		const key = `xxCITExx${i}xxCITExx`;
		placeholderMap.set(key, Number.parseInt(id));
		i++;
		return key;
	});

	let html = marked.parse(placeheld, { async: false }) as string;

	for (const [key, id] of placeholderMap) {
		const badge = `<a class="cite" href="#chunk-${id}" data-chunk="${id}">${id}</a>`;
		html = html.replaceAll(key, badge);
	}
	return html;
}
