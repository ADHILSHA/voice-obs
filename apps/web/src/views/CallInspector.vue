<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { getCall, reevaluateCall, revealCall, type CallDetail, type CriterionResult } from "../api/client";
import VerdictPill from "../components/VerdictPill.vue";

const route = useRoute();
const callId = computed(() => route.params.id as string);

const status = ref<"loading" | "error" | "ready">("loading");
const error = ref<string | null>(null);
const call = ref<CallDetail | null>(null);

const hoveredCriterionKey = ref<string | null>(null);
const revealed = ref(false);
const revealMapping = ref<Record<string, string>>({});
const revealLoading = ref(false);
const reevaluating = ref(false);

const turnEls = new Map<number, HTMLElement>();

// Avoids a TS cast inside the template expression (template expressions aren't
// reliably type-checked without vue-tsc, which doesn't run under TS7 -- see
// docs/DECISIONS.md-style notes elsewhere in this repo).
function setTurnRef(idx: number, el: unknown): void {
  if (el instanceof HTMLElement) turnEls.set(idx, el);
  else turnEls.delete(idx);
}

const results = computed<CriterionResult[]>(() => call.value?.evaluations[0]?.results ?? []);

// Static: every turn cited by a FAIL/PARTIAL criterion gets a coloured left
// border regardless of hover state (BUILD_SPEC §7).
const turnCitations = computed<Map<number, string[]>>(() => {
  const map = new Map<number, string[]>();
  for (const r of results.value) {
    if (r.verdict !== "FAIL" && r.verdict !== "PARTIAL") continue;
    for (const idx of r.evidenceTurns) {
      const existing = map.get(idx) ?? [];
      existing.push(r.criterionKey);
      map.set(idx, existing);
    }
  }
  return map;
});

// Hover-only: the currently-hovered criterion's evidence turns get an
// additional highlight and get scrolled into view (first one).
const highlightedTurns = computed<Set<number>>(() => {
  if (!hoveredCriterionKey.value) return new Set();
  const result = results.value.find((r) => r.criterionKey === hoveredCriterionKey.value);
  return new Set(result?.evidenceTurns ?? []);
});

function onHoverCriterion(key: string): void {
  hoveredCriterionKey.value = key;
  const result = results.value.find((r) => r.criterionKey === key);
  const firstTurn = result?.evidenceTurns[0];
  if (firstTurn !== undefined) {
    nextTick(() => {
      turnEls.get(firstTurn)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
}

function onLeaveCriterion(): void {
  hoveredCriterionKey.value = null;
}

interface TextSegment {
  type: "text" | "chip";
  value: string;
}

const REDACTION_TOKEN = /\{\{[A-Z]+_\d+\}\}/g;

// Redacted spans render as chips, not just substituted text -- revealed chips
// still render as chips (just showing the real value) so it stays visible that
// this span was redacted at ingestion time.
function parseSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(REDACTION_TOKEN)) {
    const index = match.index;
    if (index > lastIndex) segments.push({ type: "text", value: text.slice(lastIndex, index) });
    const token = match[0];
    segments.push({ type: "chip", value: revealed.value ? (revealMapping.value[token] ?? token) : token });
    lastIndex = index + token.length;
  }
  if (lastIndex < text.length) segments.push({ type: "text", value: text.slice(lastIndex) });
  return segments;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function loadCall(): Promise<void> {
  status.value = "loading";
  try {
    call.value = await getCall(callId.value);
    status.value = "ready";

    const highlightKey = route.query.highlight;
    if (typeof highlightKey === "string") {
      await nextTick();
      onHoverCriterion(highlightKey);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    status.value = "error";
  }
}

async function onToggleReveal(): Promise<void> {
  if (revealed.value) {
    revealed.value = false;
    return;
  }
  revealLoading.value = true;
  try {
    const { mapping } = await revealCall(callId.value);
    revealMapping.value = mapping;
    revealed.value = true;
  } finally {
    revealLoading.value = false;
  }
}

async function onReevaluate(): Promise<void> {
  reevaluating.value = true;
  try {
    call.value = await reevaluateCall(callId.value);
  } finally {
    reevaluating.value = false;
  }
}

onMounted(loadCall);
</script>

<template>
  <div v-if="status === 'loading'" class="rounded-md border border-gray-200 bg-white p-6 text-sm text-gray-500">
    Loading call…
  </div>
  <div v-else-if="status === 'error'" class="rounded-md border border-red-200 bg-red-50 p-6 text-sm text-red-700">
    {{ error }}
  </div>

  <div v-else-if="call" class="space-y-4">
    <!-- Header chips -->
    <div class="rounded-md border border-gray-200 bg-white p-4">
      <div class="flex items-center justify-between">
        <h1 class="text-sm font-semibold text-gray-900">{{ call.agent.name }} — call {{ call.ghlCallId }}</h1>
        <button
          type="button"
          class="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          :disabled="reevaluating"
          @click="onReevaluate"
        >
          {{ reevaluating ? "Re-evaluating…" : "Re-evaluate" }}
        </button>
      </div>
      <div class="mt-3 flex flex-wrap gap-2 text-xs">
        <span class="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-gray-700">
          Duration: {{ formatDuration(call.durationSec) }}
        </span>
        <span class="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-gray-700">
          Ended: {{ call.endedReason ?? "unknown" }}
        </span>
        <span class="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-gray-700">
          Health: {{ call.evaluations[0] ? call.evaluations[0].healthScore.toFixed(2) : "not evaluated" }}
        </span>
        <span
          v-for="(value, key) in call.evaluations[0]?.metrics ?? {}"
          :key="key"
          class="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-gray-700"
        >
          {{ key }}: {{ typeof value === "object" ? JSON.stringify(value) : value }}
        </span>
      </div>
      <!-- Audio control only when recordingUrl exists -- confirmed always absent
           so far, but never rendered as a dead button either way. -->
      <audio v-if="call.recordingUrl" :src="call.recordingUrl" controls class="mt-3 w-full" />
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Left: transcript -->
      <div class="rounded-md border border-gray-200 bg-white p-4">
        <div class="mb-2 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-900">Transcript</h2>
          <button
            type="button"
            class="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            :disabled="revealLoading"
            @click="onToggleReveal"
          >
            {{ revealLoading ? "Revealing…" : revealed ? "Hide redacted" : "Reveal redacted" }}
          </button>
        </div>
        <div class="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
          <div
            v-for="turn in call.turns"
            :key="turn.id"
            :ref="(el) => setTurnRef(turn.idx, el)"
            class="rounded-md border-l-4 p-2 text-sm"
            :class="[
              turnCitations.has(turn.idx) ? 'border-red-400' : 'border-transparent',
              highlightedTurns.has(turn.idx) ? 'bg-yellow-50' : 'bg-gray-50',
            ]"
          >
            <div class="text-xs font-medium uppercase tracking-wide text-gray-400">
              [{{ turn.idx }}] {{ turn.role }}
            </div>
            <p class="mt-0.5 text-gray-800">
              <template v-for="(segment, i) in parseSegments(turn.text)" :key="i">
                <span
                  v-if="segment.type === 'chip'"
                  class="inline-block rounded border border-indigo-200 bg-indigo-50 px-1 text-indigo-700"
                >
                  {{ segment.value }}
                </span>
                <template v-else>{{ segment.value }}</template>
              </template>
            </p>
          </div>
        </div>
      </div>

      <!-- Right: criteria -->
      <div class="rounded-md border border-gray-200 bg-white p-4">
        <h2 class="mb-2 text-sm font-semibold text-gray-900">Criteria</h2>
        <div v-if="results.length === 0" class="text-sm text-gray-500">
          No evaluation results yet for this call.
        </div>
        <ul v-else class="divide-y divide-gray-200">
          <li
            v-for="result in results"
            :key="result.id"
            class="cursor-default py-2"
            @mouseenter="onHoverCriterion(result.criterionKey)"
            @mouseleave="onLeaveCriterion"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-medium text-gray-900">{{ result.criterionKey }}</span>
              <VerdictPill :verdict="result.verdict" />
            </div>
            <p class="mt-1 text-xs text-gray-500">Confidence: {{ result.confidence.toFixed(2) }}</p>
            <p class="mt-1 text-sm text-gray-700">{{ result.rationale }}</p>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
