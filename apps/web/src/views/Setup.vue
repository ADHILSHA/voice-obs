<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import {
  generateScorecard,
  getAgents,
  getSyncStatus,
  triggerBackfill,
  type AgentSummary,
  type SyncStatus,
} from "../api/client";
import { useSessionStore } from "../stores/session";

const session = useSessionStore();

const agents = ref<AgentSummary[]>([]);
const agentsStatus = ref<"loading" | "empty" | "error" | "ready">("loading");
const agentsError = ref<string | null>(null);

const backfillDays = ref(30);
const syncStatus = ref<SyncStatus | null>(null);
const backfillTriggering = ref(false);
const backfillError = ref<string | null>(null);

const generatingFor = ref<string | null>(null);
const generateError = ref<string | null>(null);

let pollHandle: ReturnType<typeof setInterval> | null = null;

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

async function loadSyncStatus(): Promise<void> {
  try {
    syncStatus.value = await getSyncStatus();
  } catch {
    // Status polling failures aren't fatal to the page -- the trigger action
    // itself surfaces its own error.
  }
}

watch(
  () => syncStatus.value?.state,
  (state) => {
    if ((state === "completed" || state === "failed") && pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
      if (state === "completed") loadAgents();
    }
  },
);

function startPolling(): void {
  if (pollHandle) return;
  pollHandle = setInterval(loadSyncStatus, 2000);
}

async function onTriggerBackfill(): Promise<void> {
  backfillTriggering.value = true;
  backfillError.value = null;
  try {
    await triggerBackfill(backfillDays.value);
    startPolling();
  } catch (err) {
    backfillError.value = err instanceof Error ? err.message : String(err);
  } finally {
    backfillTriggering.value = false;
  }
}

async function onGenerateScorecard(agentId: string): Promise<void> {
  generatingFor.value = agentId;
  generateError.value = null;
  try {
    await generateScorecard(agentId);
  } catch (err) {
    generateError.value = err instanceof Error ? err.message : String(err);
  } finally {
    generatingFor.value = null;
  }
}

onMounted(() => {
  loadAgents();
  loadSyncStatus();
});

onUnmounted(() => {
  if (pollHandle) clearInterval(pollHandle);
});
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <div>
      <h1 class="text-lg font-semibold text-gray-900">Setup</h1>
      <p class="mt-1 text-sm text-gray-500">
        Connect, backfill call history, and generate a scorecard for each agent before the dashboard has
        anything to show.
      </p>
    </div>

    <section class="rounded-md border border-gray-200 bg-white p-4">
      <h2 class="text-sm font-semibold text-gray-900">Connection</h2>
      <p class="mt-2 text-sm text-gray-700">
        Status: <span class="font-medium">{{ session.status }}</span>
      </p>
      <p v-if="session.locationId" class="mt-1 text-sm text-gray-700">
        Location: <span class="font-mono">{{ session.locationId }}</span>
      </p>
      <p v-if="session.error" class="mt-2 text-sm text-red-700">{{ session.error }}</p>
    </section>

    <section class="rounded-md border border-gray-200 bg-white p-4">
      <h2 class="text-sm font-semibold text-gray-900">Backfill call history</h2>
      <div class="mt-3 flex items-center gap-2">
        <label class="text-sm text-gray-700" for="backfill-days">Days back</label>
        <input
          id="backfill-days"
          v-model.number="backfillDays"
          type="number"
          min="1"
          class="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          :disabled="backfillTriggering"
          @click="onTriggerBackfill"
        >
          {{ backfillTriggering ? "Starting…" : "Run backfill" }}
        </button>
      </div>
      <p v-if="backfillError" class="mt-2 text-sm text-red-700">{{ backfillError }}</p>
      <div v-if="syncStatus && syncStatus.state !== 'idle'" class="mt-3 text-sm text-gray-700">
        <p>
          State: <span class="font-medium">{{ syncStatus.state }}</span>
          <span v-if="syncStatus.total > 0"> — {{ syncStatus.processed }}/{{ syncStatus.total }} calls</span>
        </p>
        <p v-if="syncStatus.state === 'failed' && syncStatus.error" class="mt-1 text-red-700">
          {{ syncStatus.error }}
        </p>
        <p v-if="syncStatus.lastSyncedAt" class="text-gray-500">Last synced: {{ syncStatus.lastSyncedAt }}</p>
      </div>
    </section>

    <section class="rounded-md border border-gray-200 bg-white p-4">
      <h2 class="text-sm font-semibold text-gray-900">Agents &amp; scorecards</h2>

      <div v-if="agentsStatus === 'loading'" class="mt-3 text-sm text-gray-500">Loading agents…</div>
      <div v-else-if="agentsStatus === 'error'" class="mt-3 text-sm text-red-700">{{ agentsError }}</div>
      <div v-else-if="agentsStatus === 'empty'" class="mt-3 text-sm text-gray-500">
        No agents yet — run a backfill above to pull in your Voice AI agents and calls.
      </div>
      <ul v-else class="mt-3 divide-y divide-gray-200">
        <li v-for="agent in agents" :key="agent.id" class="flex items-center justify-between py-2">
          <div>
            <router-link :to="`/agents/${agent.id}`" class="text-sm font-medium text-indigo-700 hover:underline">
              {{ agent.name }}
            </router-link>
            <p class="text-xs text-gray-500">{{ agent.callCount }} call(s) ingested</p>
          </div>
          <button
            type="button"
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            :disabled="generatingFor === agent.id"
            @click="onGenerateScorecard(agent.id)"
          >
            {{ generatingFor === agent.id ? "Generating…" : "Generate scorecard" }}
          </button>
        </li>
      </ul>
      <p v-if="generateError" class="mt-2 text-sm text-red-700">{{ generateError }}</p>
    </section>
  </div>
</template>
