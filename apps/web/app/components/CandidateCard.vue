<script setup lang="ts">
const props = defineProps<{
  orgId: string
  candidate: CandidateView
  playerUrl: string | null
  canEdit: boolean
}>()
const emit = defineEmits<{ updated: [candidate: CandidateView] }>()

const STATUS_LABELS: Record<CandidateView['status'], string> = {
  suggested: 'Sugerido',
  accepted: 'Aceito',
  rejected: 'Rejeitado',
  rendered: 'Renderizado',
}
const NETWORKS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'youtube', label: 'YouTube' },
] as const
const LAYOUTS = Object.keys(LAYOUT_LABELS) as Layout[]

const video = ref<HTMLVideoElement | null>(null)
const error = ref('')
const busy = ref(false)
const adjusting = ref(false)
const startText = ref('')
const endText = ref('')
const network = ref<(typeof NETWORKS)[number]['id']>('instagram')

const locked = computed(() => !props.canEdit || props.candidate.status === 'rendered')

const caption = computed(() => {
  const c = props.candidate.captions
  if (!c) return ''
  if (network.value === 'youtube') {
    const y = c.youtube
    return y ? `${y.title ?? ''}\n\n${y.description ?? ''}`.trim() : ''
  }
  return c[network.value]?.caption ?? ''
})

function seekToStart() {
  if (video.value) video.value.currentTime = props.candidate.startMs / 1000
}
// O trecho do candidato: começa em startMs e pausa em endMs.
function onTimeUpdate() {
  const v = video.value
  if (v && v.currentTime * 1000 >= props.candidate.endMs) v.pause()
}
watch(() => [props.candidate.startMs, props.candidate.endMs], seekToStart)

async function run(action: () => Promise<CandidateView>): Promise<boolean> {
  error.value = ''
  busy.value = true
  try {
    emit('updated', await action())
    return true
  } catch (err) {
    error.value = apiErrorMessage(err)
    return false
  } finally {
    busy.value = false
  }
}

function decide(decision: 'accept' | 'reject') {
  return run(() =>
    api<CandidateView>(`/api/orgs/${props.orgId}/candidates/${props.candidate.id}/decision`, {
      method: 'POST',
      body: { decision },
    }),
  )
}

function patch(body: Record<string, unknown>) {
  return run(() =>
    api<CandidateView>(`/api/orgs/${props.orgId}/candidates/${props.candidate.id}`, {
      method: 'PATCH',
      body,
    }),
  )
}

function openAdjust() {
  startText.value = formatMs(props.candidate.startMs)
  endText.value = formatMs(props.candidate.endMs)
  error.value = ''
  adjusting.value = true
}

async function saveAdjust() {
  const startMs = parseMs(startText.value)
  const endMs = parseMs(endText.value)
  if (startMs === null || endMs === null) {
    error.value = 'Use o formato mm:ss.d, por exemplo 1:05.0.'
    return
  }
  if (await patch({ startMs, endMs })) adjusting.value = false
}

function changeLayout(layout: string) {
  return patch({ startMs: props.candidate.startMs, endMs: props.candidate.endMs, layout })
}

function useCurrentPosition(target: 'start' | 'end') {
  if (!video.value) return
  const text = formatMs(Math.round(video.value.currentTime * 1000))
  if (target === 'start') startText.value = text
  else endText.value = text
}
</script>

<template>
  <article data-testid="candidate-card" class="space-y-3 rounded-lg border border-default p-4">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 class="font-medium">{{ candidate.title }}</h3>
        <p class="text-sm text-muted">
          <span data-testid="candidate-range">
            {{ formatMs(candidate.startMs) }} – {{ formatMs(candidate.endMs) }}
          </span>
          · nota {{ candidate.hookScore }}
        </p>
      </div>
      <UBadge
        data-testid="candidate-status"
        :color="candidate.status === 'accepted' ? 'success' : 'neutral'"
        variant="subtle"
      >
        {{ STATUS_LABELS[candidate.status] }}
      </UBadge>
    </div>

    <video
      v-if="playerUrl"
      ref="video"
      :src="playerUrl"
      controls
      preload="metadata"
      class="max-h-72 w-full rounded-md bg-black"
      @loadedmetadata="seekToStart"
      @timeupdate="onTimeUpdate"
    />
    <p class="text-sm">{{ candidate.reason }}</p>

    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="text-muted">Layout</span>
      <select
        aria-label="Layout"
        class="rounded-md border border-accented bg-default px-2 py-1 text-sm"
        :value="candidate.layout"
        :disabled="locked || busy"
        @change="changeLayout(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="l in LAYOUTS" :key="l" :value="l">{{ LAYOUT_LABELS[l] }}</option>
      </select>
      <span v-if="candidate.hashtags.length" class="text-muted">
        {{ candidate.hashtags.map((h) => `#${h}`).join(' ') }}
      </span>
    </div>

    <div>
      <div role="tablist" class="flex gap-1 text-sm">
        <button
          v-for="n in NETWORKS"
          :key="n.id"
          type="button"
          role="tab"
          :aria-selected="network === n.id"
          class="rounded-md px-2 py-1"
          :class="network === n.id ? 'bg-elevated font-medium' : 'text-muted'"
          @click="network = n.id"
        >
          {{ n.label }}
        </button>
      </div>
      <p class="mt-2 whitespace-pre-wrap rounded-md bg-elevated p-2 text-sm">
        {{ caption || 'Sem legenda para esta rede.' }}
      </p>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" :description="error" />

    <div v-if="!locked" class="flex flex-wrap gap-2">
      <UButton
        size="sm"
        :disabled="busy || candidate.status === 'accepted'"
        @click="decide('accept')"
      >
        Aceitar
      </UButton>
      <UButton
        size="sm"
        color="neutral"
        variant="outline"
        :disabled="busy || candidate.status === 'rejected'"
        @click="decide('reject')"
      >
        Rejeitar
      </UButton>
      <UButton size="sm" color="neutral" variant="outline" :disabled="busy" @click="openAdjust">
        Ajustar início/fim
      </UButton>
    </div>

    <div v-if="adjusting" class="space-y-3 rounded-md border border-default p-3">
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-1">
          <UFormField label="Início (mm:ss.d)">
            <UInput v-model="startText" class="w-full" />
          </UFormField>
          <UButton
            size="xs"
            color="neutral"
            variant="link"
            :disabled="!playerUrl"
            @click="useCurrentPosition('start')"
          >
            Usar posição atual do player
          </UButton>
        </div>
        <div class="space-y-1">
          <UFormField label="Fim (mm:ss.d)">
            <UInput v-model="endText" class="w-full" />
          </UFormField>
          <UButton
            size="xs"
            color="neutral"
            variant="link"
            :disabled="!playerUrl"
            @click="useCurrentPosition('end')"
          >
            Usar posição atual do player
          </UButton>
        </div>
      </div>
      <div class="flex gap-2">
        <UButton size="sm" :loading="busy" @click="saveAdjust">Salvar ajuste</UButton>
        <UButton size="sm" color="neutral" variant="outline" @click="adjusting = false">
          Cancelar
        </UButton>
      </div>
    </div>
  </article>
</template>
