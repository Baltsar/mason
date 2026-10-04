import { rankQuestion } from "../src/question-engine.mjs";

const prompts = [
  "Gustaf rejected the prototype. Do not build on it or the invoice screen.",
  "The deadline is Sunday at 15:00. If the live question does not work, we must not submit to the ElevenLabs track.",
  "I switched the stack from a click demo to a local layer that follows my real work.",
];

for (const [index, prompt] of prompts.entries()) {
  const question = rankQuestion({
    prompt,
    pauseMs: 9000,
    recentApps: ["Codex", "Safari", "Finder"],
    now: Date.now() + index * 300_000,
    runtime: { questionsToday: index, lastQuestionAt: index ? new Date(Date.now() + (index - 1) * 300_000).toISOString() : null },
  });
  console.log(`${index + 1}. ${question?.kind || "no question"}: ${question?.text || "-"}`);
}
