<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  applyRecommendation,
  dismissRecommendation,
  generateRecommendations,
  getAgent,
  getRecommendations,
  getScorecard,
  updateScorecard,
  type AgentDetail,
  type CriterionCategory,
  type CriterionEditInput,
  type CriterionStat,
  type EvalMethod,
  type Recommendation,
  type Severity,
} from "../api/client";

const CATEGORIES: CriterionCategory[] = [
  "GOAL",
  "DATA_CAPTURE",
  "KNOWLEDGE",
  "CONTAINMENT",
  "COMPLIANCE",
  "CONVERSATIONAL",
];
const SEVERITIES: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const METHODS: EvalMethod[] = ["LLM", "DETERMINISTIC"];

const route = useRoute();
const agentId = computed(() => route.params.id as string);

const agent = ref<AgentDetail | null>(null);
const agentStatus = ref<"loading" | "error" | "ready">("loading");
const agentError = ref<string | null>(null);

type SortKey = "name" | "category" | "passRate" | "failingCallCount";
const sortKey = ref<SortKey>("failingCallCount");
const sortDir = ref<"asc" | "desc">("desc");

const sortedCriteria = computed<CriterionStat[]>(() => {
  const list = [...(agent.value?.criterionStats ?? [])];
  list.sort((a, b) => {
    const av = a[sortKey.value];
    const bv = b[sortKey.value];
    const cmp =
      typeof av === "string" || typeof bv === "string"
        ? String(av ?? "").localeCompare(String(bv ?? ""))
        : (av ?? -1) - (bv ?? -1);
    return sortDir.value === "asc" ? cmp : -cmp;
  });
  return list;
});

function onSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key;
    sortDir.value = "desc";
  }
}

function formatPct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

const recommendations = ref<Recommendation[]>([]);
const recommendationsStatus = ref<"loading" | "empty" | "error" | "ready">("loading");
const expandedRecId = ref<string | null>(null);
const generatingRecommendations = ref(false);
const generateError = ref<string | null>(null);
const confirmingApplyId = ref<string | null>(null);
const applyingRecId = ref<string | null>(null);
const applyError = ref<string | null>(null);

async function loadAgent(): Promise<void> {
  agentStatus.value = "loading";
  try {
    agent.value = await getAgent(agentId.value);
    agentStatus.value = "ready";
  } catch (err) {
    agentError.value = err instanceof Error ? err.message : String(err);
    agentStatus.value = "error";
  }
}

async function loadRecommendations(): Promise<void> {
  recommendationsStatus.value = "loading";
  try {
    const { recommendations: list } = await getRecommendations({ agentId: agentId.value });
    recommendations.value = list;
    recommendationsStatus.value = list.length === 0 ? "empty" : "ready";
  } catch {
    recommendationsStatus.value = "error";
  }
}

async function onGenerateRecommendations(): Promise<void> {
  generatingRecommendations.value = true;
  generateError.value = null;
  try {
    await generateRecommendations(agentId.value);
    await loadRecommendations();
  } catch (err) {
    generateError.value = err instanceof Error ? err.message : String(err);
  } finally {
    generatingRecommendations.value = false;
  }
}

function replaceRecommendation(updated: Recommendation): void {
  const index = recommendations.value.findIndex((r) => r.id === updated.id);
  if (index !== -1) recommendations.value.splice(index, 1, updated);
}

async function onConfirmApply(rec: Recommendation): Promise<void> {
  applyingRecId.value = rec.id;
  applyError.value = null;
  try {
    replaceRecommendation(await applyRecommendation(rec.id));
    confirmingApplyId.value = null;
  } catch (err) {
    applyError.value = err instanceof Error ? err.message : String(err);
  } finally {
    applyingRecId.value = null;
  }
}

async function onDismiss(rec: Recommendation): Promise<void> {
  replaceRecommendation(await dismissRecommendation(rec.id));
}

// Scorecard editor drawer
const drawerOpen = ref(false);
const editableCriteria = ref<CriterionEditInput[]>([]);
const savingScorecard = ref(false);
const confirmingVersion = ref(false);
const scorecardError = ref<string | null>(null);
const scorecardLoading = ref(false);

async function openDrawer(): Promise<void> {
  drawerOpen.value = true;
  scorecardLoading.value = true;
  scorecardError.value = null;
  try {
    const scorecard = await getScorecard(agentId.value);
    editableCriteria.value = scorecard.criteria.map((c) => ({
      key: c.key,
      name: c.name,
      description: c.description,
      category: c.category,
      severity: c.severity,
      weight: c.weight,
      method: c.method,
    }));
  } catch (err) {
    scorecardError.value = err instanceof Error ? err.message : String(err);
  } finally {
    scorecardLoading.value = false;
  }
}

function closeDrawer(): void {
  drawerOpen.value = false;
  confirmingVersion.value = false;
}

function addCriterionRow(): void {
  editableCriteria.value.push({
    key: "",
    name: "",
    description: "",
    category: "GOAL",
    severity: "MEDIUM",
    weight: 1,
    method: "LLM",
  });
}

function removeCriterionRow(index: number): void {
  editableCriteria.value.splice(index, 1);
}

async function onConfirmSave(): Promise<void> {
  savingScorecard.value = true;
  scorecardError.value = null;
  try {
    await updateScorecard(agentId.value, editableCriteria.value);
    confirmingVersion.value = false;
    drawerOpen.value = false;
    await loadAgent();
  } catch (err) {
    scorecardError.value = err instanceof Error ? err.message : String(err);
  } finally {
    savingScorecard.value = false;
  }
}

onMounted(() => {
  loadAgent();
  loadRecommendations();
});
</script>

<template>
  <div v-if="agentStatus === 'loading'" class="text-sm text-gray-500">Loading agent…</div>
  <div v-else-if="agentStatus === 'error'" class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
    {{ agentError }}
  </div>

  <div v-else-if="agent" class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold text-gray-900">{{ agent.name }}</h1>
        <p class="text-sm text-gray-500">
          Health: {{ formatPct(agent.healthScore) }} (est.) — {{ agent.callCount }} call(s)
        </p>
      </div>
      <div class="flex gap-2">
        <button
          type="button"
          class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          :disabled="generatingRecommendations"
          @click="onGenerateRecommendations"
        >
          {{ generatingRecommendations ? "Finding…" : "Find recommendations" }}
        </button>
        <button
          type="button"
          class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          @click="openDrawer"
        >
          Edit scorecard
        </button>
      </div>
    </div>
    <p v-if="generateError" class="text-sm text-red-700">{{ generateError }}</p>

    <section>
      <h2 class="mb-2 text-sm font-semibold text-gray-900">Criteria</h2>
      <div v-if="sortedCriteria.length === 0" class="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-500">
        No scorecard generated for this agent yet — go to Setup to generate one.
      </div>
      <table v-else class="w-full rounded-md border border-gray-200 bg-white text-left text-sm">
        <thead>
          <tr class="border-b border-gray-200 text-xs uppercase text-gray-500">
            <th class="cursor-pointer p-2" @click="onSort('name')">Name</th>
            <th class="cursor-pointer p-2" @click="onSort('category')">Category</th>
            <th class="cursor-pointer p-2" @click="onSort('passRate')">Pass rate</th>
            <th class="p-2">Trend</th>
            <th class="cursor-pointer p-2" @click="onSort('failingCallCount')">Failing calls</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="stat in sortedCriteria" :key="stat.criterionKey" class="border-b border-gray-100 last:border-0">
            <td class="p-2 text-gray-900">{{ stat.name }}</td>
            <td class="p-2 text-gray-600">{{ stat.category }}</td>
            <td class="p-2 text-gray-600">{{ formatPct(stat.passRate) }}</td>
            <td class="p-2 text-gray-600">
              <span v-if="stat.trend === 'up'">↑</span>
              <span v-else-if="stat.trend === 'down'">↓</span>
              <span v-else-if="stat.trend === 'flat'">→</span>
              <span v-else>—</span>
            </td>
            <td class="p-2 text-gray-600">{{ stat.failingCallCount }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2 class="mb-2 text-sm font-semibold text-gray-900">Recommendations</h2>
      <div v-if="recommendationsStatus === 'loading'" class="text-sm text-gray-500">Loading…</div>
      <div
        v-else-if="recommendationsStatus === 'empty'"
        class="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-500"
      >
        No recommendations yet — these appear once enough calls share the same failure pattern.
      </div>
      <div
        v-else-if="recommendationsStatus === 'error'"
        class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      >
        Could not load recommendations.
      </div>
      <ul v-else class="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
        <li v-for="rec in recommendations" :key="rec.id" class="p-3" :class="{ 'opacity-50': rec.status === 'DISMISSED' }">
          <div class="flex items-center justify-between gap-2">
            <button
              type="button"
              class="flex-1 text-left text-sm font-medium text-gray-900"
              @click="expandedRecId = expandedRecId === rec.id ? null : rec.id"
            >
              {{ rec.title }} ({{ rec.affectedCalls }} calls, {{ Math.round(rec.affectedPct * 100) }}%)
            </button>
            <span
              class="rounded-md border px-2 py-0.5 text-xs font-medium"
              :class="{
                'border-gray-300 bg-gray-50 text-gray-600': rec.status === 'OPEN',
                'border-green-300 bg-green-50 text-green-700': rec.status === 'APPLIED',
                'border-gray-200 bg-gray-50 text-gray-400': rec.status === 'DISMISSED',
              }"
            >
              {{ rec.status }}
            </span>
          </div>

          <div v-if="expandedRecId === rec.id" class="mt-2 space-y-2 text-sm">
            <p class="text-gray-700">{{ rec.body }}</p>
            <div class="rounded-md bg-gray-50 p-2 font-mono text-xs">
              <p class="text-red-600">- {{ rec.promptDiff.before || "(insertion, no text replaced)" }}</p>
              <p class="text-green-700">+ {{ rec.promptDiff.after }}</p>
            </div>

            <template v-if="rec.status === 'OPEN'">
              <p v-if="applyError && applyingRecId === rec.id" class="text-red-700">{{ applyError }}</p>
              <div v-if="confirmingApplyId !== rec.id" class="flex gap-2">
                <button
                  type="button"
                  class="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                  @click="confirmingApplyId = rec.id"
                >
                  Apply
                </button>
                <button
                  type="button"
                  class="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                  @click="onDismiss(rec)"
                >
                  Dismiss
                </button>
              </div>
              <div v-else class="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p>This writes directly to the agent's live prompt in HighLevel.</p>
                <div class="mt-2 flex gap-2">
                  <button
                    type="button"
                    class="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    :disabled="applyingRecId === rec.id"
                    @click="onConfirmApply(rec)"
                  >
                    {{ applyingRecId === rec.id ? "Applying…" : "Confirm and apply" }}
                  </button>
                  <button
                    type="button"
                    class="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                    @click="confirmingApplyId = null"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </template>

            <div v-else-if="rec.status === 'APPLIED'" class="rounded-md bg-gray-50 p-2 text-xs text-gray-700">
              <template v-if="rec.impact.state === 'collecting_data'">
                Collecting data — no calls evaluated since this was applied yet.
              </template>
              <template v-else>
                Baseline: {{ rec.impact.baselineRate === null ? "—" : formatPct(rec.impact.baselineRate) }} →
                Current: {{ rec.impact.currentRate === null ? "—" : formatPct(rec.impact.currentRate) }}
                <span
                  :class="{
                    'text-green-700': rec.impact.state === 'improved',
                    'text-red-700': rec.impact.state === 'worse',
                  }"
                >
                  ({{ rec.impact.state }})
                </span>
              </template>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <!-- Scorecard editor drawer -->
    <div v-if="drawerOpen" class="fixed inset-0 z-10 flex justify-end bg-black/20" @click.self="closeDrawer">
      <div class="h-full w-full max-w-xl overflow-y-auto border-l border-gray-200 bg-white p-4">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-900">Edit scorecard</h2>
          <button type="button" class="text-sm text-gray-500 hover:text-gray-700" @click="closeDrawer">Close</button>
        </div>

        <div v-if="scorecardLoading" class="text-sm text-gray-500">Loading…</div>
        <template v-else>
          <div v-for="(criterion, index) in editableCriteria" :key="index" class="mb-3 rounded-md border border-gray-200 p-3">
            <div class="grid grid-cols-2 gap-2">
              <input v-model="criterion.key" placeholder="key (snake_case)" class="rounded-md border border-gray-300 px-2 py-1 text-sm" />
              <input v-model="criterion.name" placeholder="Name" class="rounded-md border border-gray-300 px-2 py-1 text-sm" />
            </div>
            <textarea
              v-model="criterion.description"
              placeholder="Description — what pass looks like"
              class="mt-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              rows="2"
            />
            <div class="mt-2 grid grid-cols-4 gap-2">
              <select v-model="criterion.category" class="rounded-md border border-gray-300 px-2 py-1 text-sm">
                <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
              </select>
              <select v-model="criterion.severity" class="rounded-md border border-gray-300 px-2 py-1 text-sm">
                <option v-for="s in SEVERITIES" :key="s" :value="s">{{ s }}</option>
              </select>
              <select v-model="criterion.method" class="rounded-md border border-gray-300 px-2 py-1 text-sm">
                <option v-for="m in METHODS" :key="m" :value="m">{{ m }}</option>
              </select>
              <input
                v-model.number="criterion.weight"
                type="number"
                step="0.5"
                min="0"
                class="rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
            </div>
            <button type="button" class="mt-2 text-xs text-red-600 hover:underline" @click="removeCriterionRow(index)">
              Remove
            </button>
          </div>

          <button
            type="button"
            class="mb-4 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            @click="addCriterionRow"
          >
            + Add criterion
          </button>

          <p v-if="scorecardError" class="mb-2 text-sm text-red-700">{{ scorecardError }}</p>

          <div v-if="!confirmingVersion">
            <button
              type="button"
              class="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              @click="confirmingVersion = true"
            >
              Save
            </button>
          </div>
          <div v-else class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              Saving creates a <strong>new scorecard version</strong>. The current version's evaluation history stays
              intact and keeps referencing its own criteria — this doesn't rewrite past results.
            </p>
            <div class="mt-2 flex gap-2">
              <button
                type="button"
                class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                :disabled="savingScorecard"
                @click="onConfirmSave"
              >
                {{ savingScorecard ? "Saving…" : "Confirm and save" }}
              </button>
              <button
                type="button"
                class="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                @click="confirmingVersion = false"
              >
                Cancel
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
