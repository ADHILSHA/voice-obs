// Versioned per BUILD_SPEC §11: prompts live as exported template functions with a
// version constant, never inlined in business logic.
export const SCORECARD_GENERATION_PROMPT_VERSION = "scorecard-generation-v1";

export interface ScorecardGenerationPrompt {
  system: string;
  user: string;
}

export function buildScorecardGenerationPrompt(agentPrompt: string): ScorecardGenerationPrompt {
  return {
    system:
      "You are designing an observability scorecard for a voice AI phone agent. " +
      "You read the agent's own system prompt and infer what a human QA reviewer " +
      "would need to check on every call to know whether the agent did its job " +
      "well. You are specific and grounded only in what the prompt actually asks " +
      "the agent to do -- you never invent capabilities, tools, or goals the " +
      "prompt doesn't mention.",
    user: `<agent_prompt>
${agentPrompt}
</agent_prompt>

Generate between 6 and 10 observability criteria for this agent. Each criterion is
one specific, checkable thing a QA reviewer would look for in a call transcript.

Use a mix of these categories, not just one:
  goal            - did the agent accomplish its core objective for the call
  data_capture    - did the agent collect required information (name, phone, etc.)
  knowledge       - did the agent answer/handle domain questions correctly per the prompt
  containment     - did the agent stay within its instructed scope/rules
  compliance      - did the agent follow required disclosures or procedural steps
  conversational  - basic call-quality behaviors (greeting, not repeating itself, etc.)

For each criterion return:
  key: a short stable slug in snake_case, e.g. "books_appointment"
  name: a short human-readable title
  description: what "pass" looks like, written for a strict evidence-based judge
  category: one of goal | data_capture | knowledge | containment | compliance | conversational
  severity: one of low | medium | high | critical
  weight: a number, default 1, higher for criteria more central to the agent's purpose

Base every criterion on something the prompt actually says -- do not invent a goal,
tool, or rule the prompt doesn't mention. Return JSON only: an array of objects
with exactly those five fields, nothing else.`,
  };
}
