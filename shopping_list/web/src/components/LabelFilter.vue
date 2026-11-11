<script setup>
import { useI18n } from 'vue-i18n'
import Icon from './Icon.vue'
import { NO_LABEL } from '../labelFilter.js'

// The chips of a label filter (see labelFilter.js), one for each label offered.
const props = defineProps({
  filter: { type: Object, required: true },
  label: { type: String, required: true }
})

const { t } = useI18n()
</script>

<template>
  <div v-if="props.filter.labels.value.length" class="filter" role="group" :aria-label="label">
    <button
      v-for="option in props.filter.labels.value"
      :key="option.name"
      type="button"
      class="filter-chip"
      :class="{ active: props.filter.active.value.includes(option.name) }"
      :aria-pressed="props.filter.active.value.includes(option.name)"
      @click="props.filter.toggle(option.name)"
    >
      <Icon name="label" />
      {{ option.name }}
    </button>
    <button
      v-if="props.filter.offerNoLabel.value"
      type="button"
      class="filter-chip no-label"
      :class="{ active: props.filter.active.value.includes(NO_LABEL) }"
      :aria-pressed="props.filter.active.value.includes(NO_LABEL)"
      @click="props.filter.toggle(NO_LABEL)"
    >
      {{ t('labels.noLabel') }}
    </button>
    <button
      v-if="props.filter.active.value.length"
      type="button"
      class="filter-chip show-all"
      @click="props.filter.clear()"
    >
      {{ t('labels.showAll') }}
    </button>
  </div>
</template>

<style scoped>
/* The labels used, as chips that narrow the items down. */
.filter {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: -0.5rem 0 1rem;
}

.filter-chip,
.filter-chip:hover:not(:disabled) {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.375rem;
  padding: 0.3rem 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 999px;
}

.filter-chip:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.filter-chip.active,
.filter-chip.active:hover:not(:disabled) {
  color: var(--color-on-primary);
  background: var(--color-primary);
  border-color: var(--color-primary);
}

/* Not a label, so it has no label icon and a dashed edge. */
.filter-chip.no-label:not(.active) {
  border-style: dashed;
}

.filter-chip.show-all,
.filter-chip.show-all:hover:not(:disabled) {
  color: var(--color-primary);
  background: transparent;
  border-color: transparent;
}

.filter-chip :deep(svg) {
  width: 0.9375rem;
  height: 0.9375rem;
}

@media (max-width: 640px) {
  /* One row that scrolls sideways, running to the edges of the screen. */
  .filter {
    flex-wrap: nowrap;
    overflow-x: auto;
    margin: -0.5rem -1rem 1rem;
    padding: 0 1rem;
    scrollbar-width: none;
  }

  .filter::-webkit-scrollbar {
    display: none;
  }
}
</style>
