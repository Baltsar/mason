import { createHash } from "node:crypto";

const replacements = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]"],
  [/\b(?:sk_live|sk_test|xi-api-key|api[_-]?key)[_:=\s-]*[A-Za-z0-9_-]{12,}\b/gi, "[secret]"],
  [/\b(?:Bearer\s+)?[A-Za-z0-9_-]{28,}\b/g, "[token]"],
  [/\b(?:\d[ -]?){12,16}\b/g, "[card number]"],
  [/\b(?:19|20)\d{2}[01]\d[0-3]\d[-+]?\d{4}\b/g, "[personal identity number]"],
  [/\b(?:password|passwd|lösenord|lösenfras)\s*[:=]\s*\S+/gi, "$1: [hidden]"],
];

export function redact(value, max = 1200) {
  let text = String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

export function fingerprint(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 16);
}

export function safeTitle(value) {
  // Browsers append their own name and a status ("Audio playing") to the title.
  return redact(value, 180)
    .replace(/\s+[—–-]\s+(Google Chrome|Safari|Arc|Microsoft Edge|Comet|Brave|Firefox|Dia)$/i, "")
    .replace(/(\s+[—–-]\s+(Audio playing|Microphone recording|Camera recording|High memory usage\s+[—–-]\s+[\d.,]+\s*[GM]B))+$/i, "");
}
