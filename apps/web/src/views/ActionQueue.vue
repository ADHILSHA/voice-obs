<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getActions, updateAction, type ActionItem, type ActionReason, type ActionStatus } from "../api/client";

const REASONS: ActionReason[] = ["HUMAN_REQUESTED", "HIGH_INTENT_LOST", "COMPLIANCE_MISS", "KNOWLEDGE_GAP"];
const STATUSES: ActionStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED"];

const actions = ref<ActionItem[]>([]);
const status = ref<"loading" | "empty" | "error" | "ready">("loading");
const error = ref<string | null>(null);

const reasonFilter = ref<ActionReason | "">("");
const statusFilter = ref<ActionStatus | "">("");

const editingNoteFor = ref<string | null>(null);
const noteDraft = ref("");

async function load(): Promise<void> {
  status.value = "loading";
  try {
    const { actions: list } = await getActions({
      reason: reasonFilter.value || undefined,
      status: statusFilter.value || undefined,
    });
    actions.value = list;
    status.value = list.length === 0 ? "empty" : "ready";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    status.value = "error";
  }
}

function replaceAction(updated: ActionItem): void {
  const index = actions.value.findIndex((a) => a.id === updated.id);
  if (index !== -1) actions.value.splice(index, 1, updated);
}

async function onSetStatus(action: ActionItem, newStatus: ActionStatus): Promise<void> {
  replaceAction(await updateAction(action.id, { status: newStatus }));
}

async function onAssign(action: ActionItem, event: Event): Promise<void> {
  const assignee = (event.target as HTMLInputElement).value;
  replaceAction(await updateAction(action.id, { assignee: assignee || null }));
}

function startNote(action: ActionItem): void {
  editingNoteFor.value = action.id;
  noteDraft.value = action.note ?? "";
}

async function saveNote(action: ActionItem): Promise<void> {
  replaceAction(await updateAction(action.id, { note: noteDraft.value || null }));
  editingNoteFor.value = null;
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-lg font-semibold text-gray-900">Action queue</h1>

    <div class="flex gap-2">
      <select v-model="reasonFilter" class="rounded-md border border-gray-300 px-2 py-1 text-sm" @change="load">
        <option value="">All reasons</option>
        <option v-for="r in REASONS" :key="r" :value="r">{{ r }}</option>
      </select>
      <select v-model="statusFilter" class="rounded-md border border-gray-300 px-2 py-1 text-sm" @change="load">
        <option value="">All statuses</option>
        <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
      </select>
    </div>

    <div v-if="status === 'loading'" class="rounded-md border border-gray-200 bg-white p-6 text-sm text-gray-500">
      Loading…
    </div>
    <div v-else-if="status === 'error'" class="rounded-md border border-red-200 bg-red-50 p-6 text-sm text-red-700">
      {{ error }}
    </div>
    <div v-else-if="status === 'empty'" class="rounded-md border border-gray-200 bg-white p-6 text-sm text-gray-500">
      Nothing in the queue right now. Items show up here when a call needs a human follow-up.
    </div>

    <ul v-else class="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
      <li v-for="action in actions" :key="action.id" class="space-y-2 p-3">
        <div class="flex items-center justify-between">
          <div>
            <router-link :to="`/calls/${action.callId}`" class="text-sm font-medium text-indigo-700 hover:underline">
              {{ action.reason }}
            </router-link>
            <span class="ml-2 text-xs text-gray-500">{{ action.severity }}</span>
          </div>
          <select
            :value="action.status"
            class="rounded-md border border-gray-300 px-2 py-1 text-xs"
            @change="onSetStatus(action, ($event.target as HTMLSelectElement).value as ActionStatus)"
          >
            <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>

        <div class="flex items-center gap-2 text-xs text-gray-600">
          <span>Assignee:</span>
          <input
            :value="action.assignee ?? ''"
            placeholder="unassigned"
            class="rounded-md border border-gray-300 px-2 py-1"
            @change="onAssign(action, $event)"
          />
        </div>

        <div v-if="editingNoteFor === action.id" class="flex gap-2">
          <input v-model="noteDraft" class="flex-1 rounded-md border border-gray-300 px-2 py-1 text-xs" />
          <button
            type="button"
            class="rounded-md bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700"
            @click="saveNote(action)"
          >
            Save
          </button>
        </div>
        <div v-else class="flex items-center gap-2 text-xs text-gray-600">
          <span>{{ action.note || "No note" }}</span>
          <button type="button" class="text-indigo-600 hover:underline" @click="startNote(action)">Edit</button>
        </div>
      </li>
    </ul>
  </div>
</template>
