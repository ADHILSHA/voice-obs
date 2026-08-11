import type { TestCase } from "../../generated/prisma/client.js";
import { createTestCase, getExistingTestCaseKeys } from "../db/testCases.js";
import { synthesizeTestCases, type GeneratedTestCase } from "./synthesizeTestCases.js";

// A collision is not a parse failure, so it's filtered after generation rather
// than folded into the retry path -- cheapest hallucination/duplication guard
// available, mirroring suggestCriteria.ts's dropCollisions.
function dropCollisions(generated: GeneratedTestCase[], existingKeys: Set<string>): GeneratedTestCase[] {
  const seenKeys = new Set<string>();
  const kept: GeneratedTestCase[] = [];
  for (const testCase of generated) {
    if (existingKeys.has(testCase.key) || seenKeys.has(testCase.key)) continue;
    seenKeys.add(testCase.key);
    kept.push(testCase);
  }
  return kept;
}

// Orchestrator, mirrors generateRecommendationsForAgent's role: composes db/
// queries with an LLM call and persists the result. Existing test cases are
// passed to the model as context and any regenerated key colliding with one
// already on the agent is dropped -- a human may already be tracking a status
// against that key, so it must never be silently duplicated.
export async function generateTestCasesForAgent(
  agentId: string,
  agentName: string,
  agentPrompt: string,
): Promise<TestCase[]> {
  const existing = await getExistingTestCaseKeys(agentId);
  const generated = await synthesizeTestCases(agentName, agentPrompt, existing);
  const surviving = dropCollisions(generated, new Set(existing.map((e) => e.key)));

  const created: TestCase[] = [];
  for (const testCase of surviving) {
    created.push(await createTestCase({ agentId, ...testCase }));
  }
  return created;
}
