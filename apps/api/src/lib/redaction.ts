export interface RedactionState {
  mapping: Record<string, string>;
  counters: Record<string, number>;
}

export function createRedactionState(): RedactionState {
  return { mapping: {}, counters: {} };
}

const NUMBER_WORD = "zero|oh|one|two|three|four|five|six|seven|eight|nine";

// Order matters: PHONE/EMAIL run before CARD so a formatted phone number isn't
// re-caught as a bare 12+ digit run once its separators are part of the match.
const PATTERNS: { label: string; regex: RegExp }[] = [
  { label: "EMAIL", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { label: "PHONE", regex: /(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
  // Spelled-out digit runs (7+ consecutive number-words). Confirmed necessary
  // against a real captured transcript, where the caller's phone number was
  // transcribed as words ("Nine one four eight one zero three nine two four"),
  // not digits -- a digit-only regex would have left it completely unredacted.
  {
    label: "PHONE",
    regex: new RegExp(`\\b(?:${NUMBER_WORD})\\b(?:[\\s,.]+\\b(?:${NUMBER_WORD})\\b){6,}`, "gi"),
  },
  { label: "CARD", regex: /\d(?:[\s-]?\d){11,}/g },
  {
    label: "ADDRESS",
    regex:
      /\b\d{1,6}\s+(?:[A-Z][a-zA-Z]*\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b/g,
  },
];

// Names are deliberately not redacted -- they matter for evaluating whether the
// agent captured the caller's name (BUILD_SPEC §6.2).
export function redactText(text: string, state: RedactionState): string {
  let redacted = text;

  for (const { label, regex } of PATTERNS) {
    redacted = redacted.replace(regex, (match) => {
      // Case-insensitive: the same phone number recited twice in a transcript
      // commonly differs only by sentence-position capitalization ("Nine one..."
      // vs. "...that's nine one...") and must still map to one placeholder.
      const existing = Object.entries(state.mapping).find(
        ([, value]) => value.toLowerCase() === match.toLowerCase(),
      );
      if (existing) return existing[0];

      state.counters[label] = (state.counters[label] ?? 0) + 1;
      const token = `{{${label}_${state.counters[label]}}}`;
      state.mapping[token] = match;
      return token;
    });
  }

  return redacted;
}

// Walks an arbitrary JSON value (for rawPayload) applying redactText to every
// string leaf, sharing one state so the same real value gets the same placeholder
// everywhere it appears across a call's data.
export function redactDeep(value: unknown, state: RedactionState): unknown {
  if (typeof value === "string") return redactText(value, state);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, state));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, redactDeep(val, state)]));
  }
  return value;
}
