<script setup>
import { ref } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import { token, logout } from './store'
import AppSidebar from './components/shell/AppSidebar.vue'
import AppTopbar from './components/shell/AppTopbar.vue'

const router = useRouter()
const menuOpen = ref(false)

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function closeMenu() {
  menuOpen.value = false
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-paper font-body text-ink">

    <!-- Shell: only when authenticated -->
    <template v-if="token">

      <!-- Scrim (mobile) -->
      <div
        v-if="menuOpen"
        class="fixed inset-0 bg-ink/45 z-20 md:hidden"
        @click="closeMenu"
      ></div>

      <!-- Sidebar -->
      <div
        :class="[
          'fixed top-0 left-0 h-full z-30 w-60 transition-transform duration-[220ms] ease-in-out',
          'md:static md:translate-x-0 md:flex-shrink-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        ]"
      >
        <AppSidebar @navigate="closeMenu" />
      </div>

      <!-- Right side: topbar + content -->
      <div class="flex flex-col flex-1 min-w-0 h-screen">
        <AppTopbar @toggle-menu="toggleMenu" />
        <main class="flex-1 overflow-y-auto overflow-x-hidden bg-paper custom-scrollbar-light">
          <div class="w-full max-w-full px-5 py-6">
            <RouterView />
          </div>
        </main>
      </div>

    </template>

    <!-- Unauthenticated: full-screen RouterView (login page) -->
    <template v-else>
      <RouterView />
    </template>

  </div>
</template>

<style>
/* CSS Resets */
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Scrollbars */
.custom-scrollbar::-webkit-scrollbar { width: 4px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background-color: rgba(255,255,255,0.1); border-radius: 10px; }

.custom-scrollbar-light::-webkit-scrollbar { width: 6px; height: 6px; }
.custom-scrollbar-light::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar-light::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 10px; }
.custom-scrollbar-light::-webkit-scrollbar-thumb:hover { background-color: #94a3b8; }

/* Route transitions */
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s ease-out; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Tailwind 4: ensure md breakpoint maps correctly for sidebar show/hide */
@media (min-width: 880px) {
  .md\:hidden { display: none !important; }
  .md\:static { position: static !important; }
  .md\:translate-x-0 { transform: translateX(0) !important; }
  .md\:flex { display: flex !important; }
  .md\:flex-shrink-0 { flex-shrink: 0 !important; }
  .md\:inline { display: inline !important; }
}
@media (max-width: 879px) {
  .hidden.md\:flex { display: none !important; }
  .hidden.md\:inline { display: none !important; }
}
</style>
