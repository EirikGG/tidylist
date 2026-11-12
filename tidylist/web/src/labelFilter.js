import { computed, toValue } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { labelName } from './api/labels.js'

// Kept in a filter beside the label names for the items without a label. A
// label name can not be this, as it starts with a character no one types.
export const NO_LABEL = '\u0000no-label'

// Narrows some of a list's items, like what is still to buy, to the items of
// some labels. Each list keeps its own choice across visits, under the given
// key, so filtering one list leaves the others as they were. It holds label
// names, so a label deleted and made again is still chosen.
//
// Only the labels of these items are offered. A label filtered on stays
// offered while the list still has it elsewhere, so ticking off the last item
// of a shop leaves its chip to turn off, rather than the whole list showing up.
export function useLabelFilter({ listId, listItems, items, storageKey }) {
  // The chosen label names of each list, by list id.
  const byList = useLocalStorage(storageKey, {})
  const chosen = computed({
    get: () => {
      const names = byList.value?.[toValue(listId)]
      return Array.isArray(names) ? names : []
    },
    set: names => {
      const { [toValue(listId)]: _, ...others } = byList.value ?? {}
      byList.value = names.length ? { ...others, [toValue(listId)]: names } : others
    }
  })

  const nameOf = itemLabel => labelName(toValue(listId), itemLabel)

  function hasNoLabel(item) {
    return !(item.labels ?? []).some(nameOf)
  }

  function labelsIn(someItems) {
    const byName = new Map()
    for (const item of someItems) {
      for (const itemLabel of item.labels ?? []) {
        const name = nameOf(itemLabel)
        if (name && !byName.has(name)) {
          byName.set(name, { id: itemLabel.labelId, name })
        }
      }
    }
    return byName
  }

  // Sorted by name, leaving out deleted ones.
  const labels = computed(() => {
    const own = labelsIn(toValue(items))
    for (const [name, label] of labelsIn(toValue(listItems))) {
      if (!own.has(name) && chosen.value.includes(name)) {
        own.set(name, label)
      }
    }
    return [...own.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
  })

  // Only offered when some items have a label and some do not, or while it is
  // chosen and there are labels to choose instead.
  const offerNoLabel = computed(
    () =>
      labels.value.length > 0 &&
      (chosen.value.includes(NO_LABEL) || toValue(items).some(hasNoLabel))
  )

  // Labels chosen that are not offered right now are ignored, and kept for
  // when they are again.
  const active = computed(() =>
    chosen.value.filter(name =>
      name === NO_LABEL ? offerNoLabel.value : labels.value.some(label => label.name === name)
    )
  )

  function toggle(name) {
    chosen.value = chosen.value.includes(name)
      ? chosen.value.filter(other => other !== name)
      : [...chosen.value, name]
  }

  function clear() {
    chosen.value = []
  }

  // An item is shown if it has any of the chosen labels, or no label at all
  // when that is chosen.
  const visible = computed(() => {
    const all = toValue(items)
    if (!active.value.length) {
      return all
    }
    const noLabel = active.value.includes(NO_LABEL)
    return all.filter(
      item =>
        (noLabel && hasNoLabel(item)) ||
        item.labels?.some(itemLabel => active.value.includes(nameOf(itemLabel)))
    )
  })

  return { labels, offerNoLabel, active, toggle, clear, visible }
}
