// Mason says when an answer is ready: a small card that drops from the menu
// bar, says which project, which agent and how long it worked, and leaves by
// itself. It is the one thing Mason interrupts for, so it is held to rules:
//
//   it never tells someone who is already looking at that project's agent
//   (in another project's agent they are told: that answer they cannot see);
//   it never tells about an answer that came so fast its owner was waiting;
//   answers that finish together come as one card, not as a row of them;
//   someone who was away is told once, on coming back, about all of them;
//   each answer is told of once, and nothing during a call, a session or
//   while Mason is looking away.

// An answer that took the agent less than this was being waited for.
const WORTH_TELLING_SECONDS = 20;
// Finished longer ago than this, an answer is no longer news by itself.
const JUST_NOW_MS = 2 * 60_000;
// Away from the Mac for this long is being away; coming back gets one card for all.
const AWAY_MS = 5 * 60_000;
// An answer older than this is not something to hurry back to.
const STALE_MS = 3 * 3_600_000;
// A card stays this long before it leaves by itself.
export const CARD_MS = 9000;
const AT_MOST = 4;

const short = (text, max) => { const clean = String(text ?? "").replace(/\s+/g, " ").trim(); return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean; };
const keyOf = (answer) => `${answer.project}|${answer.since}`;

// What one ready answer was: who worked on it, for how long, and what was asked.
// `turns` and `prompts` come from the agents' logs.
export function describe(answer, turns = [], prompts = []) {
  const done = Date.parse(answer.since);
  const turn = turns.find((item) => item.project === answer.project && item.done === done);
  const prompt = turn && prompts.find((item) => item.project === answer.project && item.at === turn.prompt);
  return {
    key: keyOf(answer),
    project: answer.project,
    since: answer.since,
    agent: prompt?.agent || "Claude Code",
    workedSeconds: turn ? Math.max(0, Math.round((turn.done - turn.prompt) / 1000)) : null,
    asked: prompt ? short(prompt.text, 90) : "",
  };
}

// The card to show now, or nothing. `ready` are the finished answers nobody
// has looked at; `told` the keys already told of; `here` whether its owner is
// at the Mac. `reading` is true when an agent is in front and Mason cannot say
// which project's, or the name of the project whose agent is in front.
// `awayMs` is how long they had been gone when they came back just now (0 otherwise).
export function noticeFor({ ready = [], turns = [], prompts = [], told = new Set(), here = true, reading = false, busy = false, awayMs = 0, now = Date.now() } = {}) {
  if (!here || reading === true || busy) return null;
  const fresh = ready.filter((answer) => answer.project !== reading && !told.has(keyOf(answer)) && now - Date.parse(answer.since) < STALE_MS).map((answer) => describe(answer, turns, prompts));
  const back = awayMs >= AWAY_MS;
  // Back from being away: everything that finished meanwhile, as one card.
  // Otherwise only what has just finished and took long enough to walk away from.
  const answers = back ? fresh : fresh.filter((answer) => now - Date.parse(answer.since) < JUST_NOW_MS && (answer.workedSeconds === null || answer.workedSeconds >= WORTH_TELLING_SECONDS));
  if (!answers.length) return null;
  answers.sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
  return {
    id: `ready-${Date.parse(answers[0].since)}-${answers.length}`,
    kind: "ready",
    back,
    answers: answers.slice(0, AT_MOST),
    // Every answer this card stands for, also those it has no room to name.
    keys: answers.map((answer) => answer.key),
    more: Math.max(0, answers.length - AT_MOST),
    // The same thing in a line, for the island and for a reader of the screen.
    text: answers.length === 1 ? `Answer ready · ${short(answers[0].project, 20)}` : `${answers.length} answers ready`,
    until: now + CARD_MS,
  };
}
