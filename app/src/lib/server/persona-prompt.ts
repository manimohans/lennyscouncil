import type { RetrievedChunk } from './retrieval';

interface ExpertProfile {
	name: string;
	domains: string[];
	bio?: string | null;
	frameworks?: string[];
	voice_summary?: string | null;
}

const PERSONA_GUIDELINES = `You are role-playing as a real person — a public expert — in a roundtable discussion. Adhere strictly to:

1. Speak in the FIRST PERSON as the named expert. Sound like them, not like an AI.
2. Ground every concrete claim, framework, story, or data point in the SOURCE EXCERPTS provided. If something isn't in the excerpts, you may speak from your known views but never invent specifics (numbers, names, dates).
3. When you reference an excerpt, cite it inline as [c:CHUNK_ID] using the chunk_id values from SOURCE EXCERPTS.
4. CRITICAL FORMATTING RULE: Respond in ONE PARAGRAPH ONLY. No bullet points. No headers. No multiple paragraphs. Roughly 4–7 sentences, dense and decisive.
5. If you're disagreeing with something a prior expert said, name them and the specific point.
6. Be opinionated. Real practitioners take stances. Avoid corporate hedging like "it depends" without saying what it depends on.`;

function formatExcerpts(chunks: RetrievedChunk[]): string {
	if (chunks.length === 0) return '(no source excerpts available — speak from your documented public views)';
	return chunks
		.map((c) => {
			const dateBit = c.date ? ` (${c.date})` : '';
			const tsBit = c.timestamp_str ? ` @ ${c.timestamp_str}` : '';
			return `[c:${c.id}] from "${c.title}"${dateBit}${tsBit}\n  ${c.text.replace(/\n+/g, ' ').slice(0, 1000)}`;
		})
		.join('\n\n');
}

export interface PersonaPromptInput {
	expert: ExpertProfile;
	question: string;
	groundingChunks: RetrievedChunk[];
	priorTurns?: Array<{ speakerName: string; round: number; content: string }>;
	round: number;
	totalRounds: number;
}

export function buildExpertSystemPrompt(input: PersonaPromptInput): string {
	const { expert, groundingChunks, priorTurns = [], round, totalRounds, question } = input;

	const profileBlock = [
		`EXPERT IDENTITY: ${expert.name}`,
		expert.domains.length > 0 ? `DOMAINS: ${expert.domains.join(', ')}` : '',
		expert.voice_summary ? `VOICE: ${expert.voice_summary}` : '',
		expert.bio ? `BIO: ${expert.bio}` : '',
		expert.frameworks && expert.frameworks.length > 0
			? `RECURRING FRAMEWORKS: ${expert.frameworks.join('; ')}`
			: ''
	]
		.filter(Boolean)
		.join('\n');

	let roundInstruction: string;
	const hasPrior = priorTurns.length > 0;
	if (round === totalRounds) {
		roundInstruction =
			`ROUND ${round} of ${totalRounds} — CLOSING. Where did the conversation move? What is the ONE thing you most want the user to take away from your part of this? Acknowledge prior speakers if relevant. Single paragraph.`;
	} else if (!hasPrior) {
		roundInstruction =
			`ROUND ${round} of ${totalRounds} — OPENING TAKE. You are the first speaker. Give your direct, opinionated take on the user question. Lead with your strongest point. Single paragraph.`;
	} else {
		roundInstruction =
			`ROUND ${round} of ${totalRounds} — JOIN THE CONVERSATION. Other experts spoke before you (transcript above). Either: (a) respond to a specific point they made — naming them and the claim — or (b) raise the angle they missed. Don't restate; advance the discussion. Single paragraph.`;
	}

	const priorTurnsBlock =
		priorTurns.length === 0
			? ''
			: `\nPRIOR TURNS IN THIS ROUNDTABLE:\n${priorTurns
					.map((t) => `--- ${t.speakerName} (round ${t.round}) ---\n${t.content}`)
					.join('\n\n')}\n`;

	return [
		PERSONA_GUIDELINES,
		'',
		profileBlock,
		'',
		`USER QUESTION:\n${question}`,
		priorTurnsBlock,
		'',
		'SOURCE EXCERPTS YOU MAY DRAW FROM (cite by chunk_id):',
		formatExcerpts(groundingChunks),
		'',
		roundInstruction
	].join('\n');
}

export function buildModeratorSynthesisPrompt(
	question: string,
	transcript: Array<{ speakerName: string; round: number; content: string }>
): string {
	return [
		'You are the moderator of an expert roundtable. The experts above just had a multi-round discussion in response to a user question. Synthesize a final, decisive answer for the user.',
		'',
		'Output structure (use markdown):',
		'- A short opening paragraph (2–3 sentences) stating the consensus or main tension.',
		'- A bulleted "Where they agreed" section (2–4 points, each one line).',
		'- A bulleted "Where they pushed back" section (1–3 points, each one line, name the experts).',
		'- A bulleted "Concrete next steps" section (1–3 actionable items for the user).',
		'',
		'Rules:',
		'- Quote experts by name. Preserve [c:NNN] citations from the source.',
		'- Be decisive. The user wants an answer, not a survey.',
		'- Total length: 200–350 words.',
		'',
		`USER QUESTION:\n${question}`,
		'',
		'EXPERT TRANSCRIPT:',
		transcript.map((t) => `--- ${t.speakerName} (round ${t.round}) ---\n${t.content}`).join('\n\n')
	].join('\n');
}
