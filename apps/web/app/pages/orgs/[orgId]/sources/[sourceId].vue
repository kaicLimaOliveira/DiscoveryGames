<script setup lang="ts">
const POLL_MS = 5000

const route = useRoute()
const orgId = computed(() => String(route.params.orgId))
const sourceId = computed(() => String(route.params.sourceId))
const canEdit = useCanEditOrg(orgId)
const canApprove = useCanApproveOrg(orgId)
const call = serverApi()

const { data, refresh } = await useAsyncData(
  () => `source-${sourceId.value}`,
  async () => {
    const base = `/api/orgs/${orgId.value}/sources/${sourceId.value}`
    const [source, list, partners] = await Promise.all([
      call<SourceDetail>(base),
      call<{ candidates: CandidateView[] }>(`${base}/candidates`),
      call<{ partnerCreators: PartnerCreator[] }>(`/api/orgs/${orgId.value}/partner-creators`),
    ])
    return { source, candidates: list.candidates, partners: partners.partnerCreators }
  },
  { watch: [sourceId] },
)
const source = computed(() => data.value?.source)
const candidates = ref<CandidateView[]>(data.value?.candidates ?? [])
watch(data, (d) => {
  if (d) candidates.value = d.candidates
})

// URL do player: pedida no navegador (vale 1 h) só quando há candidatos.
const playerUrl = ref<string | null>(null)
async function loadPlayer() {
  if (!candidates.value.length || playerUrl.value) return
  try {
    playerUrl.value = (
      await api<{ url: string }>(`/api/orgs/${orgId.value}/sources/${sourceId.value}/player`)
    ).url
  } catch {
    playerUrl.value = null
  }
}

// A URL expira em 1 h: no erro do <video>, pede uma nova (no máximo uma vez por minuto, para
// não repetir sem fim se o erro for do próprio arquivo). A troca do src recarrega o player.
const PLAYER_RETRY_MS = 60_000
let lastPlayerRetry = 0
async function onPlayerError() {
  if (Date.now() - lastPlayerRetry < PLAYER_RETRY_MS) return
  lastPlayerRetry = Date.now()
  playerUrl.value = null
  await loadPlayer()
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void loadPlayer()
  timer = setInterval(() => {
    if (source.value && isProcessing(source.value.status)) void refresh().then(loadPlayer)
  }, POLL_MS)
})
onBeforeUnmount(() => clearInterval(timer))

function onUpdated(c: CandidateView) {
  candidates.value = candidates.value.map((x) => (x.id === c.id ? c : x))
}

const error = ref('')
const retrying = ref(false)
async function retry() {
  error.value = ''
  retrying.value = true
  try {
    await api(`/api/orgs/${orgId.value}/sources/${sourceId.value}/retry`, { method: 'POST' })
    await refresh()
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    retrying.value = false
  }
}

// Alterar declaração (aprovador ou administrador).
const rightsOpen = ref(false)
const rightsBusy = ref(false)
const rightsMsg = ref('')
const rights = ref<RightsValue>(emptyRights())

function openRights() {
  rights.value = emptyRights()
  rightsMsg.value = ''
  rightsOpen.value = true
}

async function saveRights() {
  rightsMsg.value = rightsError(rights.value)
  if (rightsMsg.value) return
  rightsBusy.value = true
  try {
    await api(`/api/orgs/${orgId.value}/sources/${sourceId.value}/rights`, {
      method: 'PUT',
      body: rightsPayload(rights.value),
    })
    rightsOpen.value = false
    await refresh()
  } catch (err) {
    rightsMsg.value = apiErrorMessage(err)
  } finally {
    rightsBusy.value = false
  }
}

function rightsEvidence(h: RightsHistoryEntry): string {
  return (
    [h.creatorName, h.licenseType, h.evidenceUrl ?? h.sourceUrl ?? h.programUrl]
      .filter(Boolean)
      .join(' · ') || '—'
  )
}

function date(value: string): string {
  return new Date(value).toLocaleString('pt-BR')
}

useHead({ title: computed(() => source.value?.title ?? 'Corte') })
</script>

<template>
  <div v-if="source" class="space-y-6">
    <div>
      <NuxtLink :to="`/orgs/${orgId}/sources`" class="text-sm text-primary underline">
        Voltar para Cortes
      </NuxtLink>
      <h1 class="mt-1 text-2xl font-semibold">{{ source.title }}</h1>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" :description="error" />

    <section class="space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <UBadge
          data-testid="source-status"
          :color="
            source.status === 'failed' || source.status === 'blocked_budget' ? 'error' : 'neutral'
          "
          variant="subtle"
        >
          {{ SOURCE_STATUS_LABELS[source.status] }}
        </UBadge>
        <UBadge :color="source.rightsBasis === 'none' ? 'warning' : 'neutral'" variant="outline">
          {{ RIGHTS_LABELS[source.rightsBasis] }}
        </UBadge>
        <UButton
          v-if="canEdit && (source.status === 'failed' || source.status === 'blocked_budget')"
          size="sm"
          :loading="retrying"
          @click="retry"
        >
          Tentar de novo
        </UButton>
      </div>
      <p v-if="source.statusDetail" class="text-sm text-muted">{{ source.statusDetail }}</p>
      <p v-if="source.rightsBasis === 'none'" class="text-sm text-muted">
        Os cortes ficam só para estudo: não poderão ser publicados nem baixados.
      </p>
    </section>

    <section class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-medium">Declaração de direitos</h2>
        <UButton v-if="canApprove" size="sm" color="neutral" variant="outline" @click="openRights">
          Alterar declaração
        </UButton>
      </div>
      <ul class="divide-y divide-default rounded-lg border border-default text-sm">
        <li
          v-for="(h, i) in source.rightsHistory"
          :key="h.declaredAt + i"
          class="flex flex-wrap justify-between gap-2 px-3 py-2"
        >
          <span>
            <span class="font-medium">{{ RIGHTS_LABELS[h.basis] }}</span>
            <span class="ml-2 text-muted">{{ rightsEvidence(h) }}</span>
          </span>
          <span class="text-muted">
            {{ h.declaredBy ?? 'usuário removido' }} em {{ date(h.declaredAt) }}
          </span>
        </li>
      </ul>
    </section>

    <section class="space-y-3">
      <h2 class="font-medium">Candidatos</h2>
      <p v-if="!candidates.length" class="text-sm text-muted">
        {{
          source.status === 'ready'
            ? 'Nenhum candidato foi encontrado neste vídeo.'
            : 'Os candidatos aparecem aqui quando a análise terminar.'
        }}
      </p>
      <CandidateCard
        v-for="c in candidates"
        :key="c.id"
        :org-id="orgId"
        :candidate="c"
        :player-url="playerUrl"
        :can-edit="canEdit"
        @updated="onUpdated"
        @player-error="onPlayerError"
      />
    </section>

    <UModal v-model:open="rightsOpen" title="Alterar declaração">
      <template #body>
        <form id="change-rights" class="space-y-4" @submit.prevent="saveRights">
          <UAlert v-if="rightsMsg" color="error" variant="subtle" :description="rightsMsg" />
          <RightsForm v-model="rights" :org-id="orgId" :partners="data?.partners ?? []" />
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="rightsOpen = false">Cancelar</UButton>
          <UButton type="submit" form="change-rights" :loading="rightsBusy">Salvar</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
