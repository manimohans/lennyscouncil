#!/usr/bin/env bun
// Headless end-to-end roundtable test. Prints events as they stream.
import { runRoundtable } from '../src/lib/server/orchestration/roundtable';
import { getCurrentUser } from '../src/lib/server/current-user';
import { sql } from '../src/lib/server/db';

const QUESTION = process.argv[2] ?? 'How should I think about pricing for a new B2B SaaS product?';

async function main() {
	console.log(`\nQuestion: ${QUESTION}\n`);
	const user = await getCurrentUser();

	let currentTurn = '';
	let printedThinkingMarker = false;
	for await (const ev of runRoundtable({ userId: user.id, question: QUESTION })) {
		if (ev.kind === 'experts_selected') {
			console.log(`\nExperts selected (${ev.experts.length}):`);
			for (const e of ev.experts) {
				console.log(`  • ${e.name} — ${e.why_selected}`);
			}
			console.log();
		} else if (ev.kind === 'turn_start') {
			currentTurn = '';
			printedThinkingMarker = false;
			console.log(`\n--- ${ev.expertName} (round ${ev.round}, turn ${ev.turnNumber}) ---`);
		} else if (ev.kind === 'thinking') {
			if (!printedThinkingMarker) {
				process.stdout.write('[thinking…');
				printedThinkingMarker = true;
			}
		} else if (ev.kind === 'content') {
			if (printedThinkingMarker) {
				process.stdout.write(']\n');
				printedThinkingMarker = false;
			}
			process.stdout.write(ev.delta);
			currentTurn += ev.delta;
		} else if (ev.kind === 'turn_end') {
			console.log(`\n   [${ev.citations?.length ?? 0} citation(s)]`);
		} else if (ev.kind === 'session_complete') {
			console.log(`\n\n✓ Session ${ev.chatId}`);
		} else if (ev.kind === 'error') {
			console.error(`\n✗ ERROR: ${ev.message}`);
			process.exit(1);
		}
	}
	await sql.end();
}

main();
