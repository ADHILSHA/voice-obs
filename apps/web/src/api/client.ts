import { useSessionStore } from "../stores/session";

export type Verdict = "PASS" | "PARTIAL" | "FAIL" | "NOT_APPLICABLE";
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type CriterionCategory =
  | "GOAL"
  | "DATA_CAPTURE"
  | "KNOWLEDGE"
  | "CONTAINMENT"
  | "COMPLIANCE"
  | "CONVERSATIONAL";
export type EvalMethod = "DETERMINISTIC" | "LLM";
export type TurnRole = "AGENT" | "CALLER" | "SYSTEM";
export type RootCause =
  | "MISSING_INSTRUCTION"
  | "AMBIGUOUS_INSTRUCTION"
  | "KNOWLEDGE_GAP"
  | "FLOW_ORDERING"
  | "GUARDRAIL_MISSING"
  | "CALLER_SIDE";
export type ActionReason = "HUMAN_REQUESTED" | "HIGH_INTENT_LOST" | "COMPLIANCE_MISS" | "KNOWLEDGE_GAP";
export type ActionStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "DISMISSED";
export type RecStatus = "OPEN" | "APPLIED" | "DISMISSED";
export type ScorecardSource = "GENERATED" | "TEMPLATE" | "MANUAL";

export interface SsoLoginResponse {
  token: string;
  user: Record<string, unknown>;
  locationId: string;
}

export async function postSsoLogin(encryptedPayload: string): Promise<SsoLoginResponse> {
  const res = await fetch("/api/auth/sso", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encryptedPayload }),
  });

  if (!res.ok) {
    throw new Error(`/api/auth/sso -> ${res.status} ${await res.text()}`);
  }

  return res.json();
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = useSessionStore();
  const headers = new Headers(init.headers);
  // Only when there's a body -- Fastify's default JSON parser throws
  // FST_ERR_CTP_EMPTY_JSON_BODY if Content-Type is application/json but the
  // body is empty, which every bodyless POST (generate scorecard, reevaluate,
  // reveal) would otherwise hit.
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (session.token) headers.set("Authorization", `Bearer ${session.token}`);

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export interface CriterionStat {
  criterionKey: string;
  name: string;
  category: CriterionCategory;
  passRate: number | null;
  trend: "up" | "down" | "flat" | null;
  failingCallCount: number;
}

export interface AgentSummary {
  id: string;
  name: string;
  healthScore: number | null;
  sparkline: (number | null)[];
  topFailingCriterion: CriterionStat | null;
  callCount: number;
}

export interface AgentDetail {
  id: string;
  locationId: string;
  ghlAgentId: string;
  name: string;
  promptSnapshot: string;
  promptFetchedAt: string;
  healthScore: number | null;
  sparkline: (number | null)[];
  callCount: number;
  criterionStats: CriterionStat[];
}

export function getAgents(): Promise<{ agents: AgentSummary[] }> {
  return apiFetch("/api/agents");
}

export function getAgent(id: string): Promise<AgentDetail> {
  return apiFetch(`/api/agents/${id}`);
}

export interface Criterion {
  id: string;
  scorecardId: string;
  key: string;
  name: string;
  description: string;
  category: CriterionCategory;
  severity: Severity;
  weight: number;
  method: EvalMethod;
  deterministicRule: unknown;
}

export interface Scorecard {
  id: string;
  agentId: string;
  version: number;
  isActive: boolean;
  source: ScorecardSource;
  createdAt: string;
  criteria: Criterion[];
}

export function generateScorecard(agentId: string): Promise<Scorecard> {
  return apiFetch(`/api/agents/${agentId}/scorecard/generate`, { method: "POST" });
}

export interface CriterionEditInput {
  key: string;
  name: string;
  description: string;
  category: CriterionCategory;
  severity: Severity;
  weight: number;
  method: EvalMethod;
}

export interface SuggestCriteriaResponse {
  useCase: string;
  suggestions: CriterionEditInput[];
}

export function suggestCriteria(agentId: string): Promise<SuggestCriteriaResponse> {
  return apiFetch(`/api/agents/${agentId}/scorecard/suggest`, { method: "POST" });
}

export function getScorecard(agentId: string): Promise<Scorecard> {
  return apiFetch(`/api/agents/${agentId}/scorecard`);
}

export function updateScorecard(agentId: string, criteria: CriterionEditInput[]): Promise<Scorecard> {
  return apiFetch(`/api/agents/${agentId}/scorecard`, {
    method: "PUT",
    body: JSON.stringify({ criteria }),
  });
}

export interface TaxonomyRow {
  rootCause: string;
  count: number;
}

export interface RecentFinding {
  callId: string;
  agentName: string;
  criterionKey: string;
  rationale: string;
  createdAt: string;
}

export interface OverviewStats {
  callsAnalyzed: number;
  meanAgentHealth: number | null;
  openRecommendations: number;
  actionQueueDepth: number;
  taxonomy: TaxonomyRow[];
  needsAttention: RecentFinding[];
}

export function getOverview(): Promise<OverviewStats> {
  return apiFetch("/api/insights/overview");
}

export interface Turn {
  id: string;
  callId: string;
  idx: number;
  role: TurnRole;
  text: string;
  startMs: number | null;
}

export interface CriterionResult {
  id: string;
  evaluationId: string;
  criterionKey: string;
  verdict: Verdict;
  confidence: number;
  evidenceTurns: number[];
  rationale: string;
  rootCause: RootCause | null;
}

export interface Evaluation {
  id: string;
  callId: string;
  scorecardVersion: number;
  healthScore: number;
  metrics: Record<string, unknown>;
  createdAt: string;
  results: CriterionResult[];
}

export interface CallSummary {
  id: string;
  agentId: string;
  ghlCallId: string;
  startedAt: string;
  durationSec: number;
  direction: string | null;
  endedReason: string | null;
  recordingUrl: string | null;
  isTrialCall: boolean;
  agent: { id: string; name: string };
  evaluations: Evaluation[];
}

export interface CallDetail extends CallSummary {
  summary: string | null;
  actionsTriggered: unknown;
  redactionMap: string | null;
  turns: Turn[];
}

export interface ListCallsResponse {
  calls: CallSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CallFilters {
  agentId?: string;
  verdict?: Verdict;
  criterionKey?: string;
  rootCause?: RootCause;
  page?: number;
}

export function getCalls(filters: CallFilters = {}): Promise<ListCallsResponse> {
  return apiFetch(`/api/calls${toQueryString(filters)}`);
}

export function getCall(id: string): Promise<CallDetail> {
  return apiFetch(`/api/calls/${id}`);
}

export function reevaluateCall(id: string): Promise<CallDetail> {
  return apiFetch(`/api/calls/${id}/reevaluate`, { method: "POST" });
}

export function revealCall(id: string): Promise<{ mapping: Record<string, string> }> {
  return apiFetch(`/api/calls/${id}/reveal`, { method: "POST" });
}

export interface ActionItem {
  id: string;
  callId: string;
  reason: ActionReason;
  severity: Severity;
  status: ActionStatus;
  assignee: string | null;
  note: string | null;
  createdAt: string;
}

export interface ActionFilters {
  reason?: ActionReason;
  status?: ActionStatus;
}

export function getActions(filters: ActionFilters = {}): Promise<{ actions: ActionItem[] }> {
  return apiFetch(`/api/actions${toQueryString(filters)}`);
}

export interface UpdateActionPatch {
  status?: ActionStatus;
  assignee?: string | null;
  note?: string | null;
}

export function updateAction(id: string, patch: UpdateActionPatch): Promise<ActionItem> {
  return apiFetch(`/api/actions/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export type ImpactState = "not_applied" | "collecting_data" | "improved" | "unchanged" | "worse";

export interface RecommendationImpact {
  state: ImpactState;
  baselineRate: number | null;
  currentRate: number | null;
}

export interface Recommendation {
  id: string;
  agentId: string;
  criterionKey: string;
  rootCause: RootCause;
  title: string;
  body: string;
  promptDiff: { before: string; after: string; insertAfterLine?: number };
  affectedCalls: number;
  affectedPct: number;
  severity: Severity;
  status: RecStatus;
  createdAt: string;
  impact: RecommendationImpact;
}

export function getRecommendations(
  filters: { agentId?: string; status?: RecStatus } = {},
): Promise<{ recommendations: Recommendation[] }> {
  return apiFetch(`/api/recommendations${toQueryString(filters)}`);
}

export function generateRecommendations(agentId: string): Promise<{ recommendations: Recommendation[] }> {
  return apiFetch(`/api/agents/${agentId}/recommendations/generate`, { method: "POST" });
}

export function applyRecommendation(id: string): Promise<Recommendation> {
  return apiFetch(`/api/recommendations/${id}/apply`, { method: "POST" });
}

export function dismissRecommendation(id: string): Promise<Recommendation> {
  return apiFetch(`/api/recommendations/${id}/dismiss`, { method: "POST" });
}

export type TestCaseStatus = "NOT_TESTED" | "PASSED" | "FAILED";

export interface TestCaseTranscriptTurn {
  role: "AGENT" | "CALLER";
  text: string;
}

export interface TestCase {
  id: string;
  agentId: string;
  key: string;
  title: string;
  scenario: string;
  expectedResult: string;
  transcript: TestCaseTranscriptTurn[] | null;
  status: TestCaseStatus;
  note: string | null;
  createdAt: string;
}

export function getTestCases(agentId: string): Promise<{ testCases: TestCase[] }> {
  return apiFetch(`/api/test-cases${toQueryString({ agentId })}`);
}

export function generateTestCases(agentId: string): Promise<{ testCases: TestCase[] }> {
  return apiFetch(`/api/agents/${agentId}/test-cases/generate`, { method: "POST" });
}

export interface UpdateTestCasePatch {
  status?: TestCaseStatus;
  note?: string | null;
}

export function updateTestCase(id: string, patch: UpdateTestCasePatch): Promise<TestCase> {
  return apiFetch(`/api/test-cases/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function triggerBackfill(days: number): Promise<{ jobId: string }> {
  return apiFetch("/api/sync/backfill", { method: "POST", body: JSON.stringify({ days }) });
}

export interface SyncStatus {
  state: string;
  processed: number;
  total: number;
  lastSyncedAt: string | null;
}

export function getSyncStatus(): Promise<SyncStatus> {
  return apiFetch("/api/sync/status");
}
