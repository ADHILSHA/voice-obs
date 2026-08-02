<script setup lang="ts">
import { computed } from "vue";

// Hand-rolled SVG, not a chart library (BUILD_SPEC §3: "do not pull in a heavy
// dashboard framework").
const props = withDefaults(defineProps<{ data: (number | null)[]; width?: number; height?: number }>(), {
  width: 80,
  height: 24,
});

const points = computed(() => {
  const values = props.data;
  const validIndices = values
    .map((value, index) => (value === null ? null : index))
    .filter((index): index is number => index !== null);

  if (validIndices.length === 0) return null;

  const numericValues = validIndices.map((i) => values[i] as number);
  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  const range = max - min || 1;
  const lastIndex = values.length - 1 || 1;

  return validIndices
    .map((i) => {
      const x = (i / lastIndex) * props.width;
      const v = values[i] as number;
      const y = props.height - ((v - min) / range) * props.height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
});
</script>

<template>
  <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`">
    <polyline
      v-if="points"
      :points="points"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      class="text-indigo-500"
    />
    <text v-else x="0" :y="height / 2" class="fill-gray-400" style="font-size: 10px">not enough data</text>
  </svg>
</template>
