// Versioned per BUILD_SPEC §11: prompts live as exported template functions with a
// version constant, never inlined in business logic.
export const TEST_CASES_PROMPT_VERSION = "test-cases-v2";

export interface ExistingTestCaseSummary {
  key: string;
  title: string;
}

export interface TestCasesPrompt {
  system: string;
  user: string;
}

export function buildTestCasesPrompt(
  agentName: string,
  agentPrompt: string,
  existingTestCases: ExistingTestCaseSummary[],
): TestCasesPrompt {
  const existingList =
    existingTestCases.map((t) => `- ${t.key}: ${t.title}`).join("\n") || "(none yet)";

  return {
    system:
      "You are writing a QA test plan for a voice AI phone agent. A human will use " +
      "each test case to place a real test call against a sandbox copy of the agent " +
      "and check whether it behaved as expected. You read the agent's own system " +
      "prompt and design scenarios grounded only in what it actually asks the agent " +
      "to do -- you never invent a capability, tool, or rule the prompt doesn't " +
      "mention. You cover a realistic mix: at least one scenario the agent should " +
      "handle cleanly end-to-end, and at least one edge case that stresses the " +
      "agent's stated limits (something outside its scope, a request for a human, " +
      "missing or reluctant caller information, an ambiguous request) -- never a " +
      "scenario the prompt gives no basis to predict an outcome for. For each test " +
      "case you also write out a simulated call transcript that plays out the " +
      "scenario turn by turn, ending in the expected result -- the agent's turns " +
      "must stay consistent with its own prompt, and the caller's turns must stay " +
      "consistent with the scenario you wrote.",
    user: `<agent_name>
${agentName}
</agent_name>

<agent_prompt>
${agentPrompt}
</agent_prompt>

<existing_test_cases>
${existingList}
</existing_test_cases>

Generate between 5 and 8 new test cases. Do not repeat the intent of an existing
test case above under a new key or wording.

For each test case return:
  key: a short stable slug in snake_case, not equal to any existing key
  title: a short human-readable label, e.g. "Pricing question the agent can't answer"
  scenario: what the caller says/does on the test call -- concrete enough for a
    human to act it out verbatim as a real test call
  expectedResult: what the agent should do or say in response, written as a
    specific, evidence-checkable statement -- not vague ("handles it well")
  transcript: an array of 4 to 14 turns simulating the full call for this
    scenario, each an object { role: "AGENT" | "CALLER", text: string }.
    Start with the agent's greeting, end at the point the expected result is
    demonstrated. Every AGENT line must be something this agent's own prompt
    would actually say; every CALLER line must stay consistent with the
    scenario. Do not summarize -- write actual dialogue.

Base every scenario, expected result, and transcript on something the agent's
own prompt actually says -- do not invent a goal, tool, or rule the prompt
doesn't mention. Return JSON only: an array of objects with exactly those five
fields.`,
  };
}
