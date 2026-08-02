<script setup lang="ts">
import { computed } from "vue";
import type { Verdict } from "../api/client";

const props = defineProps<{ verdict: Verdict }>();

const styles: Record<Verdict, string> = {
  PASS: "bg-green-50 text-green-700 border-green-200",
  PARTIAL: "bg-amber-50 text-amber-700 border-amber-200",
  FAIL: "bg-red-50 text-red-700 border-red-200",
  NOT_APPLICABLE: "bg-gray-50 text-gray-500 border-gray-200",
};

const labels: Record<Verdict, string> = {
  PASS: "Pass",
  PARTIAL: "Partial",
  FAIL: "Fail",
  NOT_APPLICABLE: "N/A",
};

const classes = computed(() => styles[props.verdict]);
const label = computed(() => labels[props.verdict]);
</script>

<template>
  <span class="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium" :class="classes">
    {{ label }}
  </span>
</template>
