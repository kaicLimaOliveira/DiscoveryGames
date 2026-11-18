<script setup lang="ts">
useHead({ title: 'Cortes' })

const POLL_MS = 5000
const MAX_BYTES = 4 * 1024 ** 3

const route = useRoute()
const orgId = computed(() => String(route.params.orgId))
const canEdit = useCanEditOrg(orgId)
const call = serverApi()

const { data, refresh } = await useAsyncData(
  () => `sources-${orgId.value}`,
  async () => {
    const [list, config, partners, budget] = await Promise.all([
      call<{ sources: SourceView[] }>(`/api/orgs/${orgId.value}/sources`),
      call<{ linkUploadEnabled: boolean }>('/api/config'),
      call<{ partnerCreators: PartnerCreator[] }>(`/api/orgs/${orgId.value}/partner-creators`),
      call<{ spentUsd: number; budgetUsd: number; alert: boolean; blocked: boolean }>(
        `/api/orgs/${orgId.value}/budget`,
      ),
    ])
    return {
      sources: list.sources,
      linkEnabled: config.linkUploadEnabled,
      partners: partners.partnerCreators,
      budget,
    }
  },
  { watch: [orgId] },
)
const sources = computed(() => data.value?.sources ?? [])
const budget = computed(() => data.value?.budget)
const budgetPercent = computed(() => {
  const b = budget.value
  return b && b.budgetUsd > 0 ? Math.round((b.spentUsd / b.budgetUsd) * 100) : 100
})

// Atualiza a cada 5 s enquanto alguma fonte estiver em processamento.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    if (sources.value.some((s) => isProcessing(s.status))) void refresh()
  }, POLL_MS)
})
onBeforeUnmount(() => clearInterval(timer))

// Formulário "Novo corte"
const open = ref(false)
const busy = ref(false)
const error = ref('')
const progress = ref(0)
const mode = ref<'file' | 'link'>('file')
const form = reactive({
  title: '',
  url: '',
  targetMin: '',
  targetMax: '',
  minSec: '',
  maxSec: '',
  language: '',
})
const rights = ref<RightsValue>(emptyRights())
const fileInput = ref<HTMLInputElement | null>(null)
let cancelUpload: (() => void) | undefined

function openForm() {
  Object.assign(form, {
    title: '',
    url: '',
    targetMin: '',
    targetMax: '',
    minSec: '',
    maxSec: '',
    language: '',
  })
  rights.value = emptyRights()
  mode.value = 'file'
  error.value = ''
  progress.value = 0
  open.value = true
}

function paramsPayload(): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const k of ['targetMin', 'targetMax', 'minSec', 'maxSec'] as const) {
    if (form[k].trim()) out[k] = Number(form[k])
  }
  if (form.language.trim()) out.language = form.language.trim()
  return Object.keys(out).length ? out : undefined
}

async function submit() {
  error.value = ''
  const title = form.title.trim()
  const file = fileInput.value?.files?.[0]
  if (!title) return void (error.value = 'Informe o título.')
  if (mode.value === 'file') {
    if (!file) return void (error.value = 'Escolha o arquivo de vídeo.')
    if (file.size > MAX_BYTES) return void (error.value = 'O vídeo deve ter até 4 GB.')
  } else if (!form.url.trim()) {
    return void (error.value = 'Informe o link do vídeo.')
  }
  const rightsMsg = rightsError(rights.value)
  if (rightsMsg) return void (error.value = rightsMsg)

  busy.value = true
  const base = `/api/orgs/${orgId.value}/sources`
  const body = { title, rights: rightsPayload(rights.value), params: paramsPayload() }
  let createdId: string | undefined
  try {
    if (mode.value === 'link') {
      await api(`${base}/link`, { method: 'POST', body: { ...body, url: form.url.trim() } })
    } else if (file) {
      const created = await api<{
        source: SourceView
        uploadId: string
        partSize: number
        partCount: number
      }>(base, {
        method: 'POST',
        body: {
          ...body,
          fileName: file.name,
          sizeBytes: file.size,
          contentType: file.type || 'video/mp4',
        },
      })
      createdId = created.source.id
      const upload = useChunkedUpload(file, created, {
        presign: async (partNumbers) =>
          (
            await api<{ parts: Array<{ partNumber: number; url: string }> }>(
              `${base}/${created.source.id}/parts`,
              { method: 'POST', body: { partNumbers } },
            )
          ).parts,
        complete: async (parts) => {
          await api(`${base}/${created.source.id}/complete`, { method: 'POST', body: { parts } })
        },
      })
      cancelUpload = upload.cancel
      const stop = watch(upload.progress, (p) => (progress.value = p))
      try {
        await upload.start()
      } finally {
        stop()
      }
    }
    open.value = false
    await refresh()
  } catch (err) {
    error.value = apiErrorMessage(err, (err as Error).message)
    // Upload que falhou no meio: abandona a fonte para não deixar partes órfãs.
    if (createdId) {
      await api(`${base}/${createdId}`, { method: 'DELETE' }).catch(() => undefined)
      await refresh()
    }
  } finally {
    busy.value = false
    cancelUpload = undefined
  }
}

function closeForm() {
  cancelUpload?.()
  open.value = false
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-semibold">Cortes</h1>
      <UButton v-if="canEdit" @click="openForm">Novo corte</UButton>
    </div>

    <UAlert
      v-if="budget?.alert"
      color="warning"
      variant="subtle"
      :description="`Você já usou ${budgetPercent}% do orçamento de IA deste mês.`"
    />

    <p v-if="!sources.length" class="text-sm text-muted">Nenhum corte ainda.</p>
    <ul v-else class="divide-y divide-default rounded-lg border border-default">
      <li
        v-for="s in sources"
        :key="s.id"
        data-testid="source-row"
        class="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
      >
        <div class="min-w-0">
          <NuxtLink
            :to="`/orgs/${orgId}/sources/${s.id}`"
            class="font-medium text-primary underline"
          >
            {{ s.title }}
          </NuxtLink>
          <p v-if="s.statusDetail" class="truncate text-sm text-muted">{{ s.statusDetail }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <UBadge color="neutral" variant="subtle">{{ SOURCE_STATUS_LABELS[s.status] }}</UBadge>
          <UBadge :color="s.rightsBasis === 'none' ? 'warning' : 'neutral'" variant="outline">
            {{ RIGHTS_LABELS[s.rightsBasis] }}
          </UBadge>
          <span class="text-muted">
            {{ Object.values(s.candidateCounts).reduce((a, b) => a + b, 0) }} candidatos
          </span>
        </div>
      </li>
    </ul>

    <UModal v-model:open="open" title="Novo corte" :dismissible="!busy">
      <template #body>
        <form id="new-source" class="space-y-4" @submit.prevent="submit">
          <UAlert v-if="error" color="error" variant="subtle" :description="error" />
          <UFormField label="Título" name="title">
            <UInput v-model="form.title" class="w-full" :disabled="busy" />
          </UFormField>

          <UFormField v-if="data?.linkEnabled" label="Origem do vídeo">
            <select
              v-model="mode"
              aria-label="Origem do vídeo"
              class="w-full rounded-md border border-accented bg-default px-2 py-1.5 text-sm"
              :disabled="busy"
            >
              <option value="file">Arquivo MP4</option>
              <option value="link">Link do YouTube (pode falhar)</option>
            </select>
          </UFormField>
          <UFormField v-if="mode === 'file'" label="Arquivo de vídeo" help="Até 2 h e 4 GB.">
            <input
              ref="fileInput"
              type="file"
              aria-label="Arquivo de vídeo"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
              class="text-sm"
              :disabled="busy"
            />
          </UFormField>
          <UFormField v-else label="Link do vídeo">
            <UInput v-model="form.url" type="url" placeholder="https://" class="w-full" />
          </UFormField>

          <RightsForm v-model="rights" :org-id="orgId" :partners="data?.partners ?? []" />

          <details class="rounded-md border border-default px-3 py-2">
            <summary class="cursor-pointer text-sm font-medium">Opções</summary>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <UFormField label="Quantidade mínima">
                <UInput v-model="form.targetMin" type="number" class="w-full" />
              </UFormField>
              <UFormField label="Quantidade máxima">
                <UInput v-model="form.targetMax" type="number" class="w-full" />
              </UFormField>
              <UFormField label="Duração mínima (s)">
                <UInput v-model="form.minSec" type="number" class="w-full" />
              </UFormField>
              <UFormField label="Duração máxima (s)">
                <UInput v-model="form.maxSec" type="number" class="w-full" />
              </UFormField>
              <UFormField label="Idioma" class="sm:col-span-2">
                <UInput v-model="form.language" placeholder="pt-BR" class="w-full" />
              </UFormField>
            </div>
            <p class="mt-2 text-sm text-muted">Em branco, valem os padrões da organização.</p>
          </details>

          <div v-if="busy && mode === 'file'" class="space-y-1">
            <progress class="w-full" max="100" :value="progress" />
            <p class="text-sm text-muted">Enviando o vídeo: {{ progress }}%</p>
          </div>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="closeForm">Cancelar</UButton>
          <UButton type="submit" form="new-source" :loading="busy">Enviar</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
