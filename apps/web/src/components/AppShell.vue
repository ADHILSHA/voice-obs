<script setup lang="ts"></script>

<template>
  <div class="flex h-screen overflow-hidden bg-gray-50 text-gray-900">
    <nav class="w-56 shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-4">
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
    <!--
      h-screen + overflow-hidden on the outer shell, overflow-y-auto here: makes
      the scrollable region explicit and internal to this element rather than
      relying on document-level scroll bubbling up through the HighLevel iframe,
      which doesn't reliably produce a scrollbar depending on how the platform
      sizes/wraps the iframe.
    -->
    <main class="flex-1 overflow-y-auto p-6 pb-20">
      <router-view />
    </main>
  </div>
</template>
