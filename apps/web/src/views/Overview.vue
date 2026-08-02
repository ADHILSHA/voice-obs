<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  getAgents,
  getCalls,
  getOverview,
  type AgentSummary,
  type CallSummary,
  type OverviewStats,
  type RootCause,
} from "../api/client";
import Sparkline from "../components/Sparkline.vue";
import StatTile from "../components/StatTile.vue";

const overviewStatus = ref<"loading" | "error" | "ready">("loading");
const overviewError = ref<string | null>(null);
const overview = ref<OverviewStats | null>(null);

const agentsStatus = ref<"loading" | "empty" | "error" | "ready">("loading");
const agentsError = ref<string | null>(null);
const agents = ref<AgentSummary[]>([]);

const activeRootCause = ref<RootCause | null>(null);
const callsStatus = ref<"loading" | "empty" | "error" | "ready">("empty");
const callsError = ref<string | null>(null);
const calls = ref<CallSummary[]>([]);

function formatPct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

async function loadOverview(): Promise<void> {
  overviewStatus.value = "loading";
  try {
    overview.value = await getOverview();
    overviewStatus.value = "ready";
  } catch (err) {
    overviewError.value = err instanceof Error ? err.message : String(err);
    overviewStatus.value = "error";
  }
}

async function loadAgents(): Promise<void> {
  agentsStatus.value = "loading";
  try {
    const { agents: list } = await getAgents();
    agents.value = list;
    agentsStatus.value = list.length === 0 ? "empty" : "ready";
  } catch (err) {
    agentsError.value = err instanceof Error ? err.message : String(err);
    agentsStatus.value = "error";
  }
}

// BUILD_SPEC §7: "Clicking [a taxonomy row] filters the call list." There's no
// separate call-list route (the 5 routes are fixed), so the filtered list lives
// inline on Overview itself.
async function onFilterByRootCause(rootCause: RootCause): Promise<void> {
  activeRootCause.value = activeRootCause.value === rootCause ? null : rootCause;
  if (!activeRootCause.value) {
    calls.value = [];
    callsStatus.value = "empty";
    return;
  }

  callsStatus.value = "loading";
  try {
    const result = await getCalls({ rootCause: activeRootCause.value });
    calls.value = result.calls;
    callsStatus.value = result.calls.length === 0 ? "empty" : "ready";
  } catch (err) {
    callsError.value = err instanceof Error ? err.message : String(err);
    callsStatus.value = "error";
  }
}

onMounted(() => {
  loadOverview();
  loadAgents();
});
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-lg font-semibold text-gray-900">Overview</h1>

    <div v-if="overviewStatus === 'loading'" class="text-sm text-gray-500">Loading…</div>
    <div v-else-if="overviewStatus === 'error'" class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {{ overviewError }}
    </div>
    <template v-else-if="overview">
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Calls analyzed" :value="String(overview.callsAnalyzed)" />
        <StatTile label="Mean agent health" :value="formatPct(overview.meanAgentHealth)" is-estimate />
        <StatTile label="Open recommendations" :value="String(overview.openRecommendations)" />
        <StatTile label="Action queue depth" :value="String(overview.actionQueueDepth)" />
      </div>

      <section>
        <h2 class="mb-2 text-sm font-semibold text-gray-900">Needs attention</h2>
        <div
          v-if="overview.needsAttention.length === 0"
          class="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-500"
        >
          No critical findings in the last few calls — nothing needs attention right now.
        </div>
        <ul v-else class="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
          <li v-for="finding in overview.needsAttention" :key="finding.callId + finding.criterionKey" class="p-3">
            <router-link
              :to="`/calls/${finding.callId}?highlight=${finding.criterionKey}`"
              class="text-sm font-medium text-indigo-700 hover:underline"
            >
              {{ finding.agentName }} — {{ finding.criterionKey }}
            </router-link>
            <p class="mt-0.5 text-sm text-gray-600">{{ finding.rationale }}</p>
          </li>
        </ul>
      </section>
    </template>

    <section>
      <h2 class="mb-2 text-sm font-semibold text-gray-900">Agents</h2>
      <div v-if="agentsStatus === 'loading'" class="text-sm text-gray-500">Loading agents…</div>
      <div v-else-if="agentsStatus === 'error'" class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {{ agentsError }}
      </div>
      <div v-else-if="agentsStatus === 'empty'" class="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-500">
        No agents ingested yet — head to Setup to run a backfill.
      </div>
      <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <router-link
          v-for="agent in agents"
          :key="agent.id"
          :to="`/agents/${agent.id}`"
          class="block rounded-md border border-gray-200 bg-white p-4 hover:border-indigo-300"
        >
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-gray-900">{{ agent.name }}</span>
            <Sparkline :data="agent.sparkline" />
          </div>
          <p class="mt-1 text-xs text-gray-500">Health: {{ formatPct(agent.healthScore) }} (est.)</p>
          <p class="mt-0.5 text-xs text-gray-500">{{ agent.callCount }} call(s)</p>
          <p v-if="agent.topFailingCriterion" class="mt-1 text-xs text-red-600">
            Top failing: {{ agent.topFailingCriterion.name }}
          </p>
        </router-link>
      </div>
    </section>

    <section v-if="overview">
      <h2 class="mb-2 text-sm font-semibold text-gray-900">Failure taxonomy</h2>
      <div v-if="overview.taxonomy.length === 0" class="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-500">
        No failures with a recorded root cause yet.
      </div>
      <ul v-else class="flex flex-wrap gap-2">
        <li v-for="row in overview.taxonomy" :key="row.rootCause">
          <button
            type="button"
            class="rounded-md border px-3 py-1.5 text-xs font-medium"
            :class="
              activeRootCause === row.rootCause
                ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            "
            @click="onFilterByRootCause(row.rootCause as RootCause)"
          >
            {{ row.rootCause }} ({{ row.count }})
          </button>
        </li>
      </ul>

      <div v-if="activeRootCause" class="mt-3">
        <div v-if="callsStatus === 'loading'" class="text-sm text-gray-500">Loading calls…</div>
        <div v-else-if="callsStatus === 'error'" class="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {{ callsError }}
        </div>
        <div v-else-if="callsStatus === 'empty'" class="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-500">
          No calls found with root cause "{{ activeRootCause }}".
        </div>
        <ul v-else class="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
          <li v-for="call in calls" :key="call.id" class="flex items-center justify-between p-3">
            <router-link :to="`/calls/${call.id}`" class="text-sm text-indigo-700 hover:underline">
              {{ call.agent.name }} — {{ call.ghlCallId }}
            </router-link>
            <span v-if="call.evaluations[0]" class="text-xs text-gray-500">
              health {{ call.evaluations[0].healthScore.toFixed(2) }}
            </span>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
