// What Mason itself hands to an agent: the short brief that picks a project up
// in a new session (continue.mjs), the longer one it was before, and the
// prompt that asks an agent to add a rule (handover.mjs). Its owner sends
// them, so they turn up in the agents' logs like anything else that was said.
// They are Mason's words and not the owner's, and are not read back as such:
// a brief would otherwise come back as "what I last asked for" in the next
// brief, and a rule prompt as something said again and again.
const OPENINGS = [
  /^Picking up [\s\S]{1,300}?\. Notes Mason wrote from my earlier sessions/,
  /^I am picking up work on [\s\S]{1,300}?The notes below were written by Mason/,
  /^I want to add one standing rule for my coding agents\./,
];
export const masonSaid = (text) => OPENINGS.some((opening) => opening.test(String(text ?? "").trimStart()));
