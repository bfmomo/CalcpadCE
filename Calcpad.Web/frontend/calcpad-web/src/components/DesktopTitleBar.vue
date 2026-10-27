<template>
  <header class="desktop-titlebar" data-tauri-drag-region @contextmenu.prevent>
    <div class="titlebar-leading">
      <img class="titlebar-logo" :src="CALCPAD_ICON_URL" alt="CalcpadCE" />
      <button class="titlebar-button" title="File menu (Alt+M)" aria-label="File menu" aria-haspopup="menu" @click="showMenu">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12"/></svg>
        <span>File</span>
      </button>
      <div class="titlebar-actions">
        <button v-for="action in actions" :key="action.id" class="titlebar-button" :title="action.title" :aria-label="action.label" :disabled="action.id === 'save' && !canSave" @click="$emit('command', action.id)">
          <svg viewBox="0 0 16 16" aria-hidden="true" :class="action.format">
            <path :d="action.path"/>
            <template v-if="action.format === 'pdf'">
              <rect class="format-badge" x="0.5" y="7" width="15" height="8" rx="1" />
              <text x="8" y="13" text-anchor="middle">PDF</text>
            </template>
            <template v-if="action.format === 'word'">
              <path d="M7 7h6M7 9h6M7 11h6"/>
              <rect class="format-badge" x="0.5" y="5" width="9" height="9" rx="1" />
              <text x="5" y="11.7" text-anchor="middle">W</text>
            </template>
          </svg>
        </button>
      </div>
    </div>
    <div class="titlebar-caption" data-tauri-drag-region :title="title">
      <span data-tauri-drag-region>{{ title }}</span>
    </div>
    <div class="titlebar-window-controls">
      <button class="titlebar-button" title="Minimize" aria-label="Minimize" @click="desktopWindow.minimize()">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5h10"/></svg>
      </button>
      <button class="titlebar-button" :title="maximized ? 'Restore' : 'Maximize'" :aria-label="maximized ? 'Restore' : 'Maximize'" @click="desktopWindow.toggleMaximize()">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="maximized ? 'M5.5 5.5h7v7h-7zM3.5 10V3.5H10' : 'M3.5 3.5h9v9h-9z'"/></svg>
      </button>
      <button class="titlebar-button titlebar-close" title="Close window" aria-label="Close window" @click="desktopWindow.close()">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 3.5 9 9m0-9-9 9"/></svg>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { CALCPAD_ICON_URL } from 'calcpad-frontend/vue/calcpad-icon'

defineProps<{ title: string; canSave: boolean }>()
defineEmits<{ command: [id: string] }>()

const desktopWindow = getCurrentWindow()
const maximized = ref(false)
const actions = [
  { id: 'save', label: 'Save document', title: 'Save document (Ctrl+S)', path: 'M1 1h11l3 3v11H1zM4 1v5h7V1M4 15V9h8v6' },
  { id: 'open', label: 'Open document', title: 'Open document (Ctrl+O)', path: 'M1 7V2h5l2 2h7v11H1zM1 7h14' },
  { id: 'export-pdf', label: 'Export to PDF', title: 'Export report to PDF and open (Ctrl+E)', format: 'pdf', path: 'M10 1H3v13h11V5zM10 1v4h4' },
  { id: 'export-docx', label: 'Export to Word', title: 'Export report to Word and open', format: 'word', path: 'M10 1H4v13h11V5zM10 1v4h5' },
]
let unlistenResize: (() => void) | undefined

async function showMenu(): Promise<void> {
  const button = document.querySelector('[aria-label="File menu"]')!.getBoundingClientRect()
  await invoke('show_app_menu', { x: button.left, y: button.bottom })
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.altKey && event.key.toLowerCase() === 'm' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    event.preventDefault()
    void showMenu()
  }
}

onMounted(async () => {
  maximized.value = await desktopWindow.isMaximized()
  unlistenResize = await desktopWindow.onResized(async () => {
    maximized.value = await desktopWindow.isMaximized()
  })
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  unlistenResize?.()
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<style scoped>
.desktop-titlebar {
  position: relative;
  display: grid;
  grid-template-columns: minmax(max-content, 1fr) minmax(0, auto) minmax(max-content, 1fr);
  flex: 0 0 36px;
  height: 36px;
  min-height: 36px;
  min-width: 0;
  align-items: stretch;
  background: var(--vscode-titleBar-activeBackground, var(--vscode-editorGroupHeader-tabsBackground));
  color: var(--vscode-titleBar-activeForeground, var(--vscode-foreground));
  border-bottom: 1px solid var(--vscode-widget-border);
  user-select: none;
}
.titlebar-leading {
  display: flex;
  z-index: 1;
  justify-self: start;
}
.titlebar-logo {
  width: 24px;
  height: 24px;
  align-self: center;
  margin: 0 8px;
}
.titlebar-caption {
  flex: 1;
  min-width: 0;
  padding: 0 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--vscode-font-size);
  text-align: center;
}
.titlebar-caption span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.titlebar-actions,
.titlebar-window-controls {
  display: flex;
  flex-shrink: 0;
}
.titlebar-window-controls {
  justify-self: end;
}
.titlebar-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 36px;
  padding: 0 9px;
  color: inherit;
  background: transparent;
  border: 0;
  font: inherit;
  font-size: var(--vscode-font-size);
  line-height: 1;
  align-self: stretch;
  cursor: default;
}
.titlebar-button svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.titlebar-leading > .titlebar-button span {
  transform: translateY(-0.5px);
}
.titlebar-actions .titlebar-button {
  min-width: 36px;
}
.titlebar-actions svg {
  width: 18px;
  height: 18px;
}
.titlebar-button:hover:not(:disabled) {
  background: var(--vscode-toolbar-hoverBackground);
}
.titlebar-button .format-badge {
  fill: currentColor;
  stroke: none;
}
.titlebar-button svg text {
  fill: var(--vscode-titleBar-activeBackground, var(--vscode-editorGroupHeader-tabsBackground));
  stroke: none;
  font: bold 6px sans-serif;
}
.titlebar-button svg.word text { font-size: 7px; }
.titlebar-button:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -3px;
}
.titlebar-close:hover {
  background: #c42b1c;
  color: white;
}
@media (max-width: 520px) {
  .titlebar-button { min-width: 24px; padding: 0 4px; }
  .titlebar-actions .titlebar-button { min-width: 28px; padding: 0 3px; }
  .titlebar-logo { margin: 0 4px; }
}
</style>
