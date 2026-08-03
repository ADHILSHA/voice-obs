// One-off: applies the CRITICAL-FAIL -> ActionItem trigger rule to evaluations
// that already existed before that rule was added. Future calls don't need
// this -- evaluateCall.ts calls the same checkForActionTriggers() function
// automatically as part of evaluation. Safe to re-run: createActionItemIfMissing
// is idempotent per (callId, reason).
import "dotenv/config";
import { checkForActionTriggers } from "../src/eval/actionTriggers.js";
import { prisma } from "../src/db/client.js";

async function main() {
  const evaluations = await prisma.evaluation.findMany({
    include: { results: true, call: { select: { id: true, agentId: true } } },
  });

  let created = 0;
  for (const evaluation of evaluations) {
    const scorecard = await prisma.scorecard.findUnique({
      where: { agentId_version: { agentId: evaluation.call.agentId, version: evaluation.scorecardVersion } },
      include: { criteria: true },
    });
    if (!scorecard) continue;

    const before = await prisma.actionItem.count({ where: { callId: evaluation.call.id } });
    await checkForActionTriggers(
      evaluation.call.id,
      evaluation.results.map((r) => ({ criterionKey: r.criterionKey, verdict: r.verdict })),
      scorecard.criteria.map((c) => ({ key: c.key, severity: c.severity, category: c.category })),
    );
    const after = await prisma.actionItem.count({ where: { callId: evaluation.call.id } });
    created += after - before;
  }

  console.log(`Scanned ${evaluations.length} evaluations, created ${created} new action item(s).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
