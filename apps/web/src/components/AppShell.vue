<script setup lang="ts"></script>

<template>
  <div class="flex min-h-screen bg-gray-50 text-gray-900">
    <nav class="w-56 shrink-0 border-r border-gray-200 bg-white p-4">
      <div class="mb-6 text-sm font-semibold text-gray-900">Voice AI Observability</div>
      <ul class="space-y-1 text-sm">
        <li>
          <router-link
            to="/"
            class="block rounded-md px-2 py-1.5 text-gray-700 hover:bg-gray-100"
            active-class="bg-indigo-50 text-indigo-700"
            exact-active-class="bg-indigo-50 text-indigo-700"
          >
            Overview
          </router-link>
        </li>
        <li>
          <router-link
            to="/actions"
            class="block rounded-md px-2 py-1.5 text-gray-700 hover:bg-gray-100"
            active-class="bg-indigo-50 text-indigo-700"
          >
            Action queue
          </router-link>
        </li>
        <li>
          <router-link
            to="/setup"
            class="block rounded-md px-2 py-1.5 text-gray-700 hover:bg-gray-100"
            active-class="bg-indigo-50 text-indigo-700"
          >
            Setup
          </router-link>
        </li>
      </ul>
    </nav>
    <main class="flex-1 p-6">
      <router-view />
    </main>
  </div>
</template>
