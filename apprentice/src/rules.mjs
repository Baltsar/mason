// Which words may be put where an agent reads its standing rules.
//
// A rule that comes from someone else, or from a model, or over the local
// address from a caller that cannot be told from Mason's own window, is not
// taken as it stands. It is offered, written or handed on only when it is one
// plain sentence about how to work. The check is a net and not a judge: it
// knows English and a little Swedish, it holds back more than it has to, and
// the two gates that count stay with a person: reading the rule, and seeing
// the change before it is saved.

// A rule that takes away the question before something is published, sent,
// deleted or paid for is never proposed for every project. Said in one place
// it was about that place, and the day after it can be "do not push".
export const ACTS_OUTWARD = /\b(publish|deploy|push|merge|release|ship|send|upload|github|delete|remove|pay|publicera|pusha|deploya|depkoya|skicka|ladda\s+upp|radera|betala|mergea)\w*/i;

export const RULE_AT_MOST = 180;

// The words in the one form they are shown, checked and handed on in: letters
// of full width and the like made plain, typographic quotes made straight,
// and every run of space one space. What is checked is then what is seen.
export const tidy = (text) => (typeof text === "string" ? text : "")
  .normalize("NFKC")
  .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
  .replace(/[\u201c\u201d\u2033]/g, '"')
  .replace(/\s+/g, " ")
  .trim();

// Names with a full stop in them that are not an address: kinds of software,
// and the Swedish for "for example".
const NOT_AN_ADDRESS = /\b(?:node|next|nuxt|vue|three|d3|react|express|nest|deno|chart|alpine|solid|svelte|astro|remix|ember|backbone|p5|socket)\.(?:js|io)\b|\bt\.ex\b|\basp\.net\b/gi;

const HELD = [
  // A character that cannot be seen, or that turns the writing around, can hide what a rule says.
  [/[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800\u3164\u115f\u1160\uffa0]/u, "it holds characters that cannot be seen"],
  // Letters of the Latin alphabet, figures and the marks of a sentence. A
  // letter that only looks like one of these would pass every list of words below.
  [/[^\p{Script=Latin}\p{M}\p{Nd} .,;:!?'"()\-\u2013\u2014\/%+&=_]/u, "it holds a character the check cannot read"],
  // A rule is one sentence in a list. A heading, a second item or a link is something else.
  [/^(?:[-+=]|\d+[.)])\s|__/, "it is laid out as more than one sentence"],
  [/https?:|www\.|\b[\w-]+\.[a-z]{2,}\b|\d+\.\d+\.\d+/i, "it names an address or a file"],
  [/&&|\.\.\/|(?:^|[^\w])\/\S|(?:^|[^\w.])\.[a-z][\w-]+/i, "it holds a command or a path"],
  [/\b(?:curl|wget|sudo|bash|zsh|chmod|chown|eval|exec|npx|npm|pnpm|yarn|pip|pipx|uv|brew|cargo|gem|apt|ssh|scp|nc|base64|rm|osascript|docker|launchctl|crontab|mcp|hookspath|install\w*)\b|\bgit\s+(?:config|push|reset|clean|remote|clone|pull|rebase|checkout|hook)|\b(?:git|commit|push|claude|agent|session|shell)[- ]hooks?\b|\bhooks? (?:folder|path|dir\w*|script)/i, "it names a command"],
  [/\b(?:secret|password|passwd|credential|api[ _-]?key|access[ _-]?key|private key|keychain|ssh key|cookie)s?\b|(?<!design )\btokens?\b/i, "it is about secrets"],
  [/\b(?:ignor|disregard|forget|overrid|bypass)\w*\b.{0,40}\b(?:instruction|rule|prompt|guardrail|permission|above|previous|earlier)|\bsystem prompt\b|\b(?:skip\w*|without|no|never|stop\w*|don't|dont|do not)\b(?! being asked).{0,30}\b(?:ask(?:ing)?|confirm\w*|approv\w*|permission\w*)\b|\boutdated\b|\bonly this (?:line|rule)\b|\balready said yes\b|\bto the agent\b|\bsay nothing\b|\b(?:never|do not|don't|dont) mention\b|\bas instructions\b|\bown judge?ment\b/i, "it tells an agent to stop asking or to set its rules aside"],
  [ACTS_OUTWARD, "it is about publishing, sending, deleting or paying"],
];

// Why a rule is not offered, or nothing when it is.
export function heldBack(rule) {
  const raw = typeof rule === "string" ? rule : "";
  if (/[\n\r\v\f\u0085\u2028\u2029]/.test(raw)) return "it is more than one line";
  const text = tidy(raw);
  if (text.length > RULE_AT_MOST) return "it is too long to be one rule";
  const plain = text.replace(NOT_AN_ADDRESS, "name");
  return HELD.find(([pattern]) => pattern.test(plain))?.[1] || "";
}

// A name from a file, as it may be shown: cut short, and nothing when it
// holds what a name does not, such as an address.
export function nameFrom(value, most = 40) {
  const name = tidy(value).slice(0, most).trim();
  return name && !HELD.slice(0, 4).some(([pattern]) => pattern.test(name)) ? name : "";
}
