<script setup lang="ts">
defineProps<{ label: string; name: string; error?: string; disabled?: boolean }>()
const model = defineModel<string[]>({ required: true })
const draft = ref('')

/** Aceita vários itens separados por vírgula; a normalização final é do servidor. */
function commit() {
  const items = draft.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  draft.value = ''
  if (!items.length) return
  const next = [...model.value]
  for (const item of items) if (!next.includes(item)) next.push(item)
  model.value = next
}

function remove(tag: string) {
  model.value = model.value.filter((t) => t !== tag)
}
</script>

<template>
  <UFormField :label="label" :name="name" :error="error" help="Separe por vírgula e tecle Enter.">
    <div class="space-y-2">
      <UInput
        v-model="draft"
        class="w-full"
        :disabled="disabled"
        @keydown.enter.prevent="commit"
        @blur="commit"
      />
      <ul class="flex flex-wrap gap-2">
        <li
          v-for="tag in model"
          :key="tag"
          class="flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-sm"
        >
          <span data-testid="tag-chip">{{ tag }}</span>
          <button
            v-if="!disabled"
            type="button"
            class="text-muted hover:text-highlighted"
            :aria-label="`Remover ${tag}`"
            @click="remove(tag)"
          >
            <UIcon name="i-lucide-x" class="size-3.5" />
          </button>
        </li>
      </ul>
    </div>
  </UFormField>
</template>
