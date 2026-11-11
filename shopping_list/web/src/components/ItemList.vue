<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useEventListener, useLocalStorage, useMediaQuery } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import Icon from './Icon.vue'
import ItemEditor from './ItemEditor.vue'
import LabelFilter from './LabelFilter.vue'
import LabelPicker from './LabelPicker.vue'
import SwipeToDelete from './SwipeToDelete.vue'
import { createItem, deleteItem, updateItem } from '../api/items.js'
import { addItemLabel, removeItemLabel, labelName, labelsOf } from '../api/labels.js'
import { useLabelFilter } from '../labelFilter.js'
import { formatShortTime, formatTime, parseBackendTime } from '../time.js'

const props = defineProps({
  list: { type: Object, required: true }
})

// 'back' is only offered on narrow screens, where the list replaces the
// overview of all lists.
const emit = defineEmits(['item-added', 'item-updated', 'item-deleted', 'back'])

const { locale, t } = useI18n()

const name = ref('')
// A message key, so the error follows a language change.
const error = ref('')
const busy = ref(false)
// The item open in the editor, if any. Looked up by id, so the editor shows
// the latest the list has, also after a refresh. Closes if someone else
// deletes the item.
const editingId = ref(null)
const editingItem = computed(() => props.list.items.find(item => item.id === editingId.value) ?? null)
// Matches the breakpoint in the styles below.
const narrow = useMediaQuery('(max-width: 640px)')

const addBar = ref(null)
const nameInput = ref(null)
// The labels the next item is added to. Kept after adding, so several items
// for the same labels can be added in a row.
const labelIds = ref([])
// Leaves out labels deleted since they were chosen.
// The list's labels, once the picker has loaded them.
const knownLabels = computed(() => labelsOf(props.list.id))
const selectedLabels = computed(
  () => knownLabels.value?.filter(label => labelIds.value.includes(label.id)) ?? []
)

// The label picker opens when the item field gets focus, and stays open while
// anything in the add bar has it.
const picking = ref(false)

function onFocusOut(event) {
  if (!addBar.value.contains(event.relatedTarget)) {
    picking.value = false
  }
}

function closePicker() {
  picking.value = false
  nameInput.value.blur()
}

function labelNames(item) {
  return (item.labels ?? []).map(label => labelName(props.list.id, label)).filter(Boolean).join(', ')
}

// The back button closes the picker first, if it is open.
function onBack() {
  if (picking.value) {
    closePicker()
  } else {
    emit('back')
  }
}

// Completed items are listed under the others, in a section that can be
// collapsed. Whether it is collapsed is remembered for every list.
const showCompleted = useLocalStorage('shoppinglist.show-completed', true)

// What is still to buy and what is bought each have their own label filter,
// offering only the labels of those items.
const allOpenItems = computed(() => props.list.items.filter(item => item.completed === null))
const allCompletedItems = computed(() => props.list.items.filter(item => item.completed !== null))

// The key is from when labels were called stores, so the choice is kept.
const openFilter = useLabelFilter({
  listId: () => props.list.id,
  listItems: () => props.list.items,
  items: allOpenItems,
  storageKey: 'shoppinglist.store-filter-names'
})
const completedFilter = useLabelFilter({
  listId: () => props.list.id,
  listItems: () => props.list.items,
  items: allCompletedItems,
  storageKey: 'shoppinglist.completed-filter-names'
})

// Newest first by the given time, and the newest item first when the times
// are the same. Sorted here as well as by the backend, so an item added or
// completed here moves to its place straight away.
function newestFirst(timeOf) {
  const ms = value => (value ? parseBackendTime(value).getTime() : 0)
  return (a, b) => ms(timeOf(b)) - ms(timeOf(a)) || b.id - a.id
}

// What is still to buy by when it was added, what is bought by when.
const openItems = computed(() =>
  [...openFilter.visible.value].sort(newestFirst(item => item.created))
)
const completedItems = computed(() =>
  [...completedFilter.visible.value].sort(newestFirst(item => item.completed))
)
// The store sections the backend sorts items into, in the order a shop
// usually has them. Items it has not sorted yet, or could not, come last.
const SECTION_ORDER = [
  'produce',
  'bakery',
  'dairy',
  'meat_fish',
  'frozen',
  'dry_goods',
  'spices_sauces',
  'snacks',
  'drinks',
  'household',
  'personal_care',
  'baby_pet',
  'tools_hardware',
  'electrical',
  'furniture_home',
  'clothing',
  'car',
  'uncategorised'
]

function sectionOf(item) {
  return SECTION_ORDER.includes(item.category) ? item.category : 'uncategorised'
}

// Lists shown without sections, by id. Grouping is on unless turned off, and
// remembered for each list, as not every list is for shopping.
const ungroupedLists = useLocalStorage('shoppinglist.ungrouped-lists', [])
const grouped = computed(() => !ungroupedLists.value.includes(props.list.id))

function toggleGrouped() {
  ungroupedLists.value = grouped.value
    ? [...ungroupedLists.value, props.list.id]
    : ungroupedLists.value.filter(id => id !== props.list.id)
}

// What is still to buy, under a heading for each section that has any, or as
// one list when not grouped. Newest first within each.
const openGroups = computed(() => {
  if (!grouped.value) {
    return [{ key: 'open', heading: null, items: openItems.value }]
  }
  return SECTION_ORDER.map(section => ({
    key: `open-${section}`,
    heading: `sections.${section}`,
    items: openItems.value.filter(item => sectionOf(item) === section)
  })).filter(group => group.items.length)
})

// Completed is there while anything is, also when its filter hides it all.
const sections = computed(() => [
  ...openGroups.value,
  ...(allCompletedItems.value.length ? [{ key: 'completed', items: completedItems.value }] : [])
])

// Items with a completion still being saved, so a double tap is not sent twice.
const toggling = ref(new Set())

// A completed item stays where it is, ticked, for a moment before it moves to
// Completed, so a mistaken tap can be undone by tapping again. It is only
// saved once that time is up, so Home Assistant never hears of a completion
// that was undone. Item id to its timer.
const HANG_MS = 2000
const hanging = ref(new Map())

function isDone(item) {
  return item.completed !== null || hanging.value.has(item.id)
}

function toggleCompleted(item) {
  if (hanging.value.has(item.id)) {
    clearTimeout(hanging.value.get(item.id))
    hanging.value.delete(item.id)
  } else if (item.completed === null) {
    hanging.value.set(item.id, setTimeout(() => finishCompleting(item.id), HANG_MS))
  } else {
    saveCompleted(item, false)
  }
}

// Saves the item as it is now, as it may have been renamed meanwhile. One
// deleted meanwhile is left alone.
function finishCompleting(id) {
  clearTimeout(hanging.value.get(id))
  hanging.value.delete(id)
  const item = props.list.items.find(other => other.id === id)
  if (item && item.completed === null) {
    saveCompleted(item, true)
  }
}

// Leaving the list or the app saves what is waiting, so it is not lost.
function finishAll() {
  for (const id of [...hanging.value.keys()]) {
    finishCompleting(id)
  }
}
onBeforeUnmount(finishAll)
useEventListener(document, 'visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    finishAll()
  }
})

// Shown straight away, and put back if saving fails. The timestamp is a
// stand-in until the backend returns its own.
async function saveCompleted(item, completed) {
  if (toggling.value.has(item.id)) {
    return
  }

  const previous = item.completed
  error.value = ''
  toggling.value.add(item.id)
  emit('item-updated', { ...item, completed: completed ? new Date().toISOString() : null })

  try {
    emit('item-updated', await updateItem(item.id, item.name, item.amount ?? 1, completed))
  } catch (e) {
    emit('item-updated', { ...item, completed: previous })
    error.value = e.status === 429 ? 'errors.tooManyRequests' : 'lists.completeFailed'
  } finally {
    toggling.value.delete(item.id)
  }
}

// Saved as soon as a label is tapped, apart from the name, and shown straight
// away. Put back if saving fails.
async function changeLabels(item, ids) {
  const previous = item.labels ?? []
  const previousIds = previous.map(label => label.labelId)
  const added = ids.filter(id => !previousIds.includes(id))
  const removed = previousIds.filter(id => !ids.includes(id))

  error.value = ''
  // Labels not loaded yet keep the name the item had.
  const own = (knownLabels.value ?? [])
    .filter(label => ids.includes(label.id))
    .map(label => ({ labelId: label.id, name: label.name }))
  const others = previous.filter(
    itemLabel => ids.includes(itemLabel.labelId) && !own.some(o => o.labelId === itemLabel.labelId)
  )
  emit('item-updated', {
    ...item,
    labels: [...own, ...others].sort((a, b) => a.name.localeCompare(b.name))
  })

  try {
    await Promise.all([
      ...added.map(id => addItemLabel(item.id, id)),
      ...removed.map(id => removeItemLabel(item.id, id))
    ])
  } catch (e) {
    emit('item-updated', { ...item, labels: previous })
    error.value = e.status === 429 ? 'errors.tooManyRequests' : 'lists.completeFailed'
  }
}

function swipeFailed(e) {
  error.value = e.status === 429 ? 'errors.tooManyRequests' : 'edit.deleteFailed'
}

async function submit() {
  error.value = ''
  busy.value = true

  try {
    const item = await createItem(
      props.list.id,
      name.value,
      selectedLabels.value.map(label => label.id)
    )
    emit('item-added', { ...item, completed: null })
    name.value = ''
    // Done adding: the picker closes, and on phones the keyboard with it. A
    // failed add keeps it open to try again.
    closePicker()
  } catch (e) {
    error.value = e.status === 429 ? 'errors.tooManyRequests' : 'lists.addItemFailed'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="list">
    <div class="scroll">
      <div class="title-row">
        <h2>{{ list.name }}</h2>
        <button
          type="button"
          class="group-toggle"
          :class="{ active: grouped }"
          :aria-pressed="grouped"
          :aria-label="t('sections.group')"
          :title="t('sections.group')"
          @click="toggleGrouped"
        >
          <Icon name="sections" />
        </button>
      </div>

      <LabelFilter :filter="openFilter" :label="t('labels.filter')" />

      <p v-if="!list.items.length" class="empty">{{ t('lists.noItems') }}</p>
      <p v-else-if="!allOpenItems.length" class="empty">{{ t('lists.allCompleted') }}</p>
      <p v-else-if="!openItems.length" class="empty">{{ t('lists.noFilteredItems') }}</p>

      <template v-for="section in sections" :key="section.key">
        <button
          v-if="section.key === 'completed'"
          type="button"
          class="section-toggle"
          :aria-expanded="showCompleted"
          aria-controls="completed-items"
          @click="showCompleted = !showCompleted"
        >
          <Icon name="chevron" class="chevron" :class="{ open: showCompleted }" />
          {{ t('lists.completed', { count: section.items.length }) }}
        </button>
        <h3 v-else-if="section.heading" class="section-heading">{{ t(section.heading) }}</h3>

        <template v-if="section.key === 'completed' && showCompleted">
          <LabelFilter
            class="completed-filter"
            :filter="completedFilter"
            :label="t('labels.filterCompleted')"
          />
          <p v-if="!section.items.length" class="empty">{{ t('lists.noFilteredItems') }}</p>
        </template>

        <ul
          v-if="section.items.length && (section.key !== 'completed' || showCompleted)"
          :id="section.key === 'completed' ? 'completed-items' : undefined"
          class="items"
        >
          <li
            v-for="item in section.items"
            :key="item.id"
            :class="{ completed: isDone(item) }"
          >
            <SwipeToDelete
              :enabled="narrow"
              :remove="() => deleteItem(item.id)"
              @removed="emit('item-deleted', item.id)"
              @failed="swipeFailed"
            >
              <div class="item-row">
                <button
                  type="button"
                  class="complete"
                  :class="{ done: isDone(item) }"
                  role="checkbox"
                  :aria-checked="isDone(item)"
                  @click="toggleCompleted(item)"
                >
                  <span class="circle">
                    <Icon name="check" />
                  </span>
                  <span class="text">
                    <!-- The amount only when there is more than one. -->
                    <span class="item-name">
                      <span v-if="item.amount > 1" class="item-amount">{{ item.amount }} ×</span>
                      {{ item.name }}
                    </span>
                    <!-- Its labels, links, files and time on one line, to keep rows
                         short. Long label names are cut short to fit. -->
                    <span class="meta">
                      <span v-if="labelNames(item)" class="item-label" :title="labelNames(item)">
                        <Icon name="label" />
                        <span class="label-names">{{ labelNames(item) }}</span>
                      </span>
                      <span v-if="item.links?.length || item.attachments?.length" class="item-extras">
                        <span
                          v-if="item.links?.length"
                          :title="t('item.linkCount', item.links.length)"
                        >
                          <Icon name="link" />
                          {{ item.links.length }}
                        </span>
                        <span
                          v-if="item.attachments?.length"
                          :title="t('item.fileCount', item.attachments.length)"
                        >
                          <Icon name="paperclip" />
                          {{ item.attachments.length }}
                        </span>
                      </span>
                      <!-- When it was bought, or for what is still to buy, when it
                           was added: the date, or the time for today. The full
                           date and time are in the editor, and on hover. -->
                      <time
                        v-if="item.completed"
                        class="completed-at"
                        :datetime="parseBackendTime(item.completed).toISOString()"
                        :title="formatTime(parseBackendTime(item.completed), locale)"
                      >
                        {{ t('lists.completedAt', { time: formatShortTime(parseBackendTime(item.completed), locale) }) }}
                      </time>
                      <time
                        v-else-if="item.created"
                        class="completed-at"
                        :datetime="parseBackendTime(item.created).toISOString()"
                        :title="formatTime(parseBackendTime(item.created), locale)"
                      >
                        {{ t('lists.addedAt', { time: formatShortTime(parseBackendTime(item.created), locale) }) }}
                      </time>
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  class="edit"
                  :aria-label="t('edit.editItem', { name: item.name })"
                  :title="t('edit.edit')"
                  @click="editingId = item.id"
                >
                  <Icon name="pencil" />
                </button>
              </div>
            </SwipeToDelete>
          </li>
        </ul>
      </template>
    </div>

    <!-- The picker sits beside the form rather than in it, as editing a label
         uses a form of its own. -->
    <div
      ref="addBar"
      class="add"
      @focusout="onFocusOut"
      @keydown.esc="closePicker"
    >
      <p v-if="error" class="error" aria-live="polite">{{ t(error) }}</p>
      <ul v-if="selectedLabels.length && !picking" class="chosen-labels">
        <li v-for="label in selectedLabels" :key="label.id">
          <button type="button" class="chosen" @mousedown.prevent @click="nameInput.focus()">
            <Icon name="label" />
            {{ label.name }}
          </button>
          <button
            type="button"
            class="clear"
            :aria-label="t('labels.clear', { name: label.name })"
            :title="t('labels.clear', { name: label.name })"
            @mousedown.prevent
            @click="labelIds = labelIds.filter(id => id !== label.id)"
          >
            <Icon name="x" />
          </button>
        </li>
      </ul>
      <form class="row" @submit.prevent="submit">
        <!-- mousedown is cancelled so the field keeps its focus until the
             click decides between closing the picker and going back. -->
        <button
          type="button"
          class="back"
          :aria-label="picking ? t('labels.close') : t('lists.back')"
          :title="picking ? t('labels.close') : t('lists.back')"
          @mousedown.prevent
          @click="onBack"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <input
          ref="nameInput"
          v-model.trim="name"
          :aria-label="t('lists.itemName')"
          :placeholder="t('lists.itemName')"
          maxlength="512"
          required
          @focus="picking = true"
        />
        <!-- mousedown is cancelled so the field keeps its focus until the item
             is saved. Otherwise the picker closes on the tap, the layout
             shifts, and the tap can miss the button. -->
        <button type="submit" :disabled="busy || !name" @mousedown.prevent>
          {{ t('lists.addItem') }}
        </button>
      </form>
      <LabelPicker
        v-if="picking"
        v-model="labelIds"
        :list-id="list.id"
        :compact="narrow"
        @done="nameInput.focus()"
      />
    </div>

    <ItemEditor
      v-if="editingItem"
      :key="editingItem.id"
      :item="editingItem"
      :list-id="list.id"
      @item-updated="item => emit('item-updated', item)"
      @labels-changed="ids => changeLabels(editingItem, ids)"
      @item-deleted="id => emit('item-deleted', id)"
      @close="editingId = null"
    />
  </section>
</template>

<style scoped>
/* On wide screens the add field sits above the items; on narrow screens it is
   a bar at the bottom, as the overview of lists has. */
.list {
  display: flex;
  flex-direction: column;
  max-width: 40rem;
  margin: 0 auto;
}

.add {
  order: -1;
  margin-bottom: 1.25rem;
}

.title-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0 0 1.25rem;
}

h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 1.5rem;
  overflow-wrap: anywhere;
}

.group-toggle,
.group-toggle:hover:not(:disabled) {
  display: flex;
  flex-shrink: 0;
  padding: 0.45rem;
  color: var(--color-text-muted);
  background: transparent;
}

.group-toggle:hover:not(:disabled) {
  background: var(--color-background);
}

.group-toggle.active,
.group-toggle.active:hover:not(:disabled) {
  color: var(--color-primary);
}

/* The store section above its items. The first has no space above it. */
.section-heading {
  margin: 0.875rem 0 0.375rem;
  padding: 0 0.25rem;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.section-heading:first-of-type {
  margin-top: 0;
}

.row {
  display: flex;
  gap: 0.5rem;
}

.row input {
  min-width: 0;
}

.row button {
  flex-shrink: 0;
}

.back {
  display: none;
}

.items {
  margin: 0;
  padding: 0;
  list-style: none;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  box-shadow: 0 1px 3px var(--color-shadow);
  /* Keeps a swiped row's red background inside the rounded corners. */
  overflow: hidden;
}

/* The padding is on the row inside the li, so a swipe moves all of it. */
.item-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.75rem;
  padding: 0.125rem 0.5rem 0.125rem 0.25rem;
}

/* The circle and the name are one button, so tapping anywhere on the item
   but the pencil completes it. */
.complete,
.complete:hover:not(:disabled) {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
  min-width: 0;
  min-height: 2.5rem;
  padding: 0 0 0 0.75rem;
  font-weight: inherit;
  text-align: left;
  color: inherit;
  background: transparent;
  border: none;
}

.circle {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  width: 1.375rem;
  height: 1.375rem;
  color: transparent;
  border: 2px solid var(--color-text-muted);
  border-radius: 50%;
  transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.complete:hover .circle {
  border-color: var(--color-primary);
}

.complete:active .circle {
  transform: scale(0.9);
}

.complete.done .circle {
  color: var(--color-on-primary);
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.circle :deep(svg) {
  width: 0.875rem;
  height: 0.875rem;
  stroke-width: 3.5;
}

.section-toggle,
.section-toggle:hover:not(:disabled) {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin: 1.25rem 0 0.625rem;
  padding: 0.375rem 0.5rem 0.375rem 0.25rem;
  font-size: 0.9375rem;
  color: var(--color-text-muted);
  background: transparent;
  border: none;
}

.section-toggle:hover:not(:disabled) {
  color: var(--color-text);
}

.chevron {
  transition: transform 0.15s ease;
}

.chevron.open {
  transform: rotate(90deg);
}

.text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  padding: 0.125rem 0;
}

/* The details under the name, side by side on one line. */
.meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0 0.75rem;
  line-height: 1.3;
}

.meta:empty {
  display: none;
}

/* At the right end, so it is in the same place on every row, whatever
   labels, links and files come before it. */
.meta .completed-at {
  margin-left: auto;
  white-space: nowrap;
  flex-shrink: 0;
}

/* The labels give way first when the line is too narrow. */
.meta .item-label {
  min-width: 0;
}

.label-names {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.meta .item-extras {
  flex-shrink: 0;
}

.item-name {
  overflow-wrap: anywhere;
}

.item-amount {
  font-weight: 600;
  color: var(--color-primary);
}

.items li.completed .item-amount {
  color: inherit;
}

.completed-at,
.item-label,
.item-extras {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}

.item-label,
.item-extras,
.item-extras > span {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

/* How many links and files the item has, opened with the pencil. */
.item-extras {
  gap: 0.625rem;
}

.item-label :deep(svg),
.item-extras :deep(svg) {
  width: 0.875rem;
  height: 0.875rem;
  flex-shrink: 0;
}

.picker {
  margin-top: 0.75rem;
}

.chosen-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  margin: 0 0 0.5rem;
  padding: 0;
  list-style: none;
}

.chosen-labels li {
  display: flex;
  align-items: center;
}

.chosen,
.chosen:hover:not(:disabled),
.clear,
.clear:hover:not(:disabled) {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-primary);
  background: transparent;
}

.chosen :deep(svg),
.clear :deep(svg) {
  width: 1rem;
  height: 1rem;
}

.clear,
.clear:hover:not(:disabled) {
  color: var(--color-text-muted);
}

.chosen:hover:not(:disabled),
.clear:hover:not(:disabled) {
  background: var(--color-background);
}

.edit,
.edit:hover:not(:disabled) {
  display: flex;
  flex-shrink: 0;
  padding: 0.45rem;
  color: var(--color-text-muted);
  background: transparent;
}

.edit:hover:not(:disabled) {
  color: var(--color-text);
  background: var(--color-background);
}

.items li + li {
  border-top: 1px solid var(--color-border);
}

.items li.completed .item-name {
  text-decoration: line-through;
  color: var(--color-text-muted);
}

/* Just under the Completed toggle, closer than the top filter is to the
   title. */
.filter.completed-filter {
  margin-top: 0;
  margin-bottom: 0.75rem;
}

.empty {
  margin: 0;
  color: var(--color-text-muted);
}

.error {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  color: var(--color-error);
}

@media (max-width: 640px) {
  .list {
    flex: 1;
    min-height: 0;
    width: 100%;
    max-width: none;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1.25rem 1rem;
  }

  .add {
    order: 0;
    margin: 0;
    padding: 0.625rem 1rem calc(0.625rem + env(safe-area-inset-bottom));
    background: var(--color-surface);
    border-top: 1px solid var(--color-border);
  }

  .picker {
    margin-top: 0.5rem;
  }

  .filter.completed-filter {
    margin-top: 0;
    margin-bottom: 0.75rem;
  }

  .back,
  .back:hover:not(:disabled) {
    display: flex;
    align-items: center;
    padding: 0.4rem;
    color: var(--color-text);
    background: transparent;
  }

  .back svg {
    width: 1.5rem;
    height: 1.5rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}
</style>
