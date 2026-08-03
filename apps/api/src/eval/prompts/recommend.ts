// Versioned per BUILD_SPEC §11: prompts live as exported template functions with a
// version constant, never inlined in business logic.
export const RECOMMEND_PROMPT_VERSION = "recommend-v1";

export interface RecommendEvidenceInput {
  rationale: string;
  turns: { idx: number; role: string; text: string }[];
}

export interface RecommendPrompt {
  system: string;
  user: string;
}

export function buildRecommendPrompt(
  agentPrompt: string,
  criterionName: string,
  criterionDescription: string,
  rootCause: string,
  evidence: RecommendEvidenceInput[],
): RecommendPrompt {
  const evidenceBlock = evidence
    .map((e, i) => {
      const transcript = e.turns.map((t) => `  [${t.idx}] ${t.role}: ${t.text}`).join("\n");
      return `Example ${i + 1}:\nJudge rationale: ${e.rationale}\nCited turns:\n${transcript}`;
    })
    .join("\n\n");

  return {
    system:
      "You are a voice AI prompt engineer. You are given a recurring failure pattern " +
      "from a phone agent's call transcripts and the agent's current system prompt. " +
      "You propose the smallest possible edit to the prompt that would fix the " +
      "pattern -- never a rewrite, never a change unrelated to this specific " +
      "failure. Your proposed 'before' text must be copied verbatim, character for " +
      "character, from the agent prompt you were given -- it will be used for a " +
      "literal find-and-replace, so any paraphrase or invented text will fail.",
    user: `<agent_prompt>
${agentPrompt}
</agent_prompt>

<failing_criterion>
${criterionName}: ${criterionDescription}
</failing_criterion>

<root_cause>${rootCause}</root_cause>

<evidence>
${evidenceBlock}
</evidence>

Propose a minimal fix to the agent prompt above that addresses this recurring
failure. Return JSON only, an object with exactly these fields:

  title: a short human-readable title for the fix (one line)
  body: 1-3 sentences explaining the fix and why it addresses the root cause
  promptDiff: an object with:
    before: a short verbatim substring of <agent_prompt> to replace (copy it
      exactly -- whitespace, punctuation, everything). Use "" (empty string) if
      this is a pure insertion with nothing to replace.
    after: the replacement text, or the text to insert if before is ""
    insertAfterLine: only when before is "" -- the 1-based line number in
      <agent_prompt> (counting from the first line as 1) after which "after"
      should be inserted as a new line. Omit this field entirely when before is
      non-empty.

Keep the edit as small as possible. Do not restate or rewrite parts of the prompt
that already work.`,
  };
}
