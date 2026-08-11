// Versioned per BUILD_SPEC §11: prompts live as exported template functions with a
// version constant, never inlined in business logic.
export const SUGGEST_CRITERIA_PROMPT_VERSION = "suggest-criteria-v1";

export interface ExistingCriterionSummary {
  key: string;
  name: string;
  description: string;
}

export interface SuggestCriteriaPrompt {
  system: string;
  user: string;
}

export function buildSuggestCriteriaPrompt(
  agentName: string,
  agentPrompt: string,
  existingCriteria: ExistingCriterionSummary[],
): SuggestCriteriaPrompt {
  const existingList = existingCriteria
    .map((c) => `- ${c.key}: ${c.name} — ${c.description}`)
    .join("\n");

  return {
    system:
      "You are reviewing an existing observability scorecard for a voice AI phone agent " +
      "and looking for gaps. You first infer, from the agent's name and its own system " +
      "prompt, the specific real-world use case this agent serves (e.g. 'outbound lead " +
      "qualification for a roofing company', not a generic label like 'sales'). You then " +
      "propose additional criteria a QA reviewer for that specific use case would also " +
      "want checked, that the current scorecard does not already cover. You are specific " +
      "and grounded only in what the prompt actually asks the agent to do -- you never " +
      "invent capabilities, tools, or goals the prompt doesn't mention. You are not " +
      "afraid to propose nothing if the scorecard already covers the use case well.",
    user: `<agent_name>
${agentName}
</agent_name>

<agent_prompt>
${agentPrompt}
</agent_prompt>

<existing_criteria>
${existingList}
</existing_criteria>

Step 1: Infer this agent's specific use case from its name and prompt (a short phrase,
not one of a fixed set of labels).

Step 2: Looking at that use case, identify anything a QA reviewer would check on every
call that the existing criteria above do NOT already cover. Do not propose a criterion
that restates an existing one under a new key, a reworded name, or a narrower/broader
version of the same check -- if it's already covered, even loosely, skip it.

Step 3: Propose between 0 and 6 new criteria. Zero is a valid and expected answer when
the existing criteria already cover the use case well -- do not pad the list to reach a
minimum.

Base every criterion on something the agent's own prompt actually says -- do not invent
a goal, tool, or rule the prompt doesn't mention.

For each new criterion return the same five fields as scorecard generation:
  key: a short stable slug in snake_case, not equal to any existing key
  name: a short human-readable title
  description: what "pass" looks like, written for a strict evidence-based judge
  category: one of goal | data_capture | knowledge | containment | compliance | conversational
  severity: one of low | medium | high | critical
  weight: a number, default 1, higher for criteria more central to the agent's purpose

Return JSON only: an object with exactly two fields -- "useCase" (a string) and
"suggestions" (an array of 0 to 6 objects with exactly those five criterion fields).`,
  };
}
