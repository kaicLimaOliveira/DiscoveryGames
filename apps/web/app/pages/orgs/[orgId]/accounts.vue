<script setup lang="ts">
useHead({ title: 'Contas' })

type Platform = 'instagram' | 'facebook' | 'youtube' | 'tiktok'
interface Account {
  id: string
  platform: Platform
  externalId: string
  displayName: string
  status: 'active' | 'needs_reauth'
  dailyLimit: number | null
}
interface MetaPage {
  pageId: string
  pageName: string
  instagram: { id: string; username: string } | null
}

const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
}

const route = useRoute()
const orgId = computed(() => String(route.params.orgId))
const canManage = useCanManageOrg(orgId)
const requestFetch = useRequestFetch()
const { data, refresh } = await useAsyncData(
  () => `accounts-${orgId.value}`,
  () => requestFetch<{ accounts: Account[] }>(`/api/orgs/${orgId.value}/accounts`),
  { watch: [orgId] },
)
const accounts = computed(() => data.value?.accounts ?? [])

const error = ref('')
const notice = ref('')

// Retorno do OAuth do Google (?connected=youtube ou ?error=...).
if (route.query.connected === 'youtube') notice.value = 'Canal do YouTube conectado.'
if (typeof route.query.error === 'string' && route.query.error) error.value = route.query.error
if (route.query.connected || route.query.error) {
  await navigateTo({ path: route.path }, { replace: true })
}

// $fetch com rota dinâmica estoura a profundidade de tipos das rotas do Nitro; URL tipada como string.
const accountCall = $fetch as (
  url: string,
  opts: { method: 'PATCH' | 'DELETE'; body?: unknown },
) => Promise<unknown>

function base(): string {
  return `/api/orgs/${orgId.value}/accounts`
}

function statusLabel(a: Account): string {
  if (a.platform === 'tiktok') return 'manual'
  return a.status === 'active' ? 'ativo' : 'reconectar'
}

async function run(action: () => Promise<unknown>): Promise<void> {
  error.value = ''
  notice.value = ''
  try {
    await action()
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
  await refresh()
}

async function saveLimit(a: Account, raw: string) {
  const trimmed = raw.trim()
  const dailyLimit = trimmed === '' ? null : Number(trimmed)
  if (dailyLimit === a.dailyLimit) return
  await run(() => accountCall(`${base()}/${a.id}`, { method: 'PATCH', body: { dailyLimit } }))
}

async function disconnect(a: Account) {
  if (!window.confirm(`Desconectar ${PLATFORM_LABELS[a.platform]} ${a.displayName}?`)) return
  await run(() => accountCall(`${base()}/${a.id}`, { method: 'DELETE' }))
}

function startYoutube() {
  return navigateTo(`${base()}/youtube/start`, { external: true })
}

// TikTok
const tiktokOpen = ref(false)
const tiktokHandle = ref('')
const tiktokError = ref('')
const tiktokBusy = ref(false)

function openTiktok() {
  tiktokHandle.value = ''
  tiktokError.value = ''
  tiktokOpen.value = true
}

async function linkTiktok() {
  tiktokError.value = ''
  tiktokBusy.value = true
  try {
    await $fetch(`${base()}/tiktok`, { method: 'POST', body: { handle: tiktokHandle.value } })
    tiktokOpen.value = false
    await refresh()
  } catch (err) {
    tiktokError.value = apiErrorMessage(err)
  } finally {
    tiktokBusy.value = false
  }
}

// Meta: o token fica só neste estado e é apagado ao conectar ou cancelar.
const metaOpen = ref(false)
const metaToken = ref('')
const metaPages = ref<MetaPage[] | null>(null)
const metaPageId = ref('')
const metaFacebookOnly = ref(false)
const metaError = ref('')
const metaBusy = ref(false)

const selectedPage = computed(() => metaPages.value?.find((p) => p.pageId === metaPageId.value))
const canConnectMeta = computed(
  () => !!selectedPage.value && (!!selectedPage.value.instagram || metaFacebookOnly.value),
)

function resetMeta() {
  metaToken.value = ''
  metaPages.value = null
  metaPageId.value = ''
  metaFacebookOnly.value = false
  metaError.value = ''
}

function openMeta() {
  resetMeta()
  metaOpen.value = true
}

function closeMeta() {
  resetMeta()
  metaOpen.value = false
}

watch(metaOpen, (isOpen) => {
  if (!isOpen) resetMeta()
})

async function discoverMeta() {
  metaError.value = ''
  metaBusy.value = true
  try {
    const res = await $fetch<{ pages: MetaPage[] }>(`${base()}/meta/discover`, {
      method: 'POST',
      body: { token: metaToken.value },
    })
    metaPages.value = res.pages
    metaPageId.value = ''
    metaFacebookOnly.value = false
    if (!res.pages.length) metaError.value = 'Nenhuma Página encontrada para este token.'
  } catch (err) {
    metaError.value = apiErrorMessage(err)
  } finally {
    metaBusy.value = false
  }
}

async function connectMeta() {
  metaError.value = ''
  metaBusy.value = true
  try {
    await $fetch(`${base()}/meta/connect`, {
      method: 'POST',
      body: {
        token: metaToken.value,
        pageId: metaPageId.value,
        ...(metaFacebookOnly.value ? { includeFacebookWithoutInstagram: true } : {}),
      },
    })
    closeMeta()
    await refresh()
  } catch (err) {
    metaError.value = apiErrorMessage(err)
  } finally {
    metaBusy.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-semibold">Contas</h1>

    <UAlert v-if="error" color="error" variant="subtle" :description="error" />
    <UAlert v-if="notice" color="success" variant="subtle" :description="notice" />

    <p v-if="!accounts.length" class="text-muted">Nenhuma conta vinculada a esta organização.</p>
    <ul v-else class="divide-y divide-default rounded-md border border-default">
      <li
        v-for="a in accounts"
        :key="a.id"
        data-testid="account-row"
        class="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
      >
        <span class="w-24 font-medium">{{ PLATFORM_LABELS[a.platform] }}</span>
        <span class="min-w-32 flex-1">{{ a.displayName }}</span>
        <UBadge
          :color="a.status === 'needs_reauth' && a.platform !== 'tiktok' ? 'warning' : 'success'"
          variant="subtle"
        >
          {{ statusLabel(a) }}
        </UBadge>
        <template v-if="a.platform !== 'tiktok'">
          <label v-if="canManage" class="flex items-center gap-2">
            <span class="text-muted">limite/dia</span>
            <input
              type="number"
              min="1"
              max="1000"
              placeholder="—"
              :aria-label="`Limite diário de ${a.displayName}`"
              :value="a.dailyLimit ?? ''"
              class="w-20 rounded-md border border-accented bg-default px-2 py-1"
              @change="saveLimit(a, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <span v-else class="text-muted">limite/dia {{ a.dailyLimit ?? '—' }}</span>
        </template>
        <div v-if="canManage" class="ml-auto flex gap-2">
          <UButton
            v-if="a.platform === 'youtube' && a.status === 'needs_reauth'"
            size="xs"
            @click="startYoutube"
          >
            Reconectar
          </UButton>
          <UButton
            v-else-if="a.status === 'needs_reauth' && a.platform !== 'tiktok'"
            size="xs"
            @click="openMeta"
          >
            Reconectar
          </UButton>
          <UButton size="xs" color="neutral" variant="outline" @click="disconnect(a)">
            {{ a.platform === 'tiktok' ? 'Remover' : 'Desconectar' }}
          </UButton>
        </div>
      </li>
    </ul>

    <div v-if="canManage" class="flex flex-wrap gap-2">
      <UButton color="neutral" variant="outline" icon="i-lucide-plus" @click="openMeta">
        Meta (token do System User)
      </UButton>
      <UButton color="neutral" variant="outline" icon="i-lucide-plus" @click="startYoutube">
        YouTube
      </UButton>
      <UButton color="neutral" variant="outline" icon="i-lucide-plus" @click="openTiktok">
        TikTok (@)
      </UButton>
    </div>
    <p v-else class="text-sm text-muted">
      Somente administradores da organização podem vincular ou remover contas.
    </p>

    <UModal v-model:open="tiktokOpen" title="Vincular TikTok">
      <template #body>
        <form id="link-tiktok" class="space-y-4" @submit.prevent="linkTiktok">
          <UAlert v-if="tiktokError" color="error" variant="subtle" :description="tiktokError" />
          <UFormField
            label="Usuário do TikTok"
            name="handle"
            help="Só o @ da conta: a publicação é manual assistida."
          >
            <UInput v-model="tiktokHandle" required class="w-full" />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="tiktokOpen = false">Cancelar</UButton>
          <UButton type="submit" form="link-tiktok" :loading="tiktokBusy">Vincular</UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="metaOpen" title="Conectar Meta">
      <template #body>
        <div class="space-y-4">
          <UAlert v-if="metaError" color="error" variant="subtle" :description="metaError" />
          <UFormField
            label="Token do System User"
            name="token"
            help="Usado só para buscar e conectar; não fica guardado na tela."
          >
            <UInput
              v-model="metaToken"
              type="password"
              autocomplete="off"
              class="w-full"
              :disabled="metaPages !== null"
            />
          </UFormField>
          <UButton
            v-if="metaPages === null"
            :loading="metaBusy"
            :disabled="!metaToken"
            @click="discoverMeta"
          >
            Buscar Páginas
          </UButton>
          <fieldset v-else class="space-y-2">
            <legend class="text-sm font-medium">Página</legend>
            <label
              v-for="p in metaPages"
              :key="p.pageId"
              class="flex items-center gap-2 rounded-md border border-default px-3 py-2 text-sm"
            >
              <input v-model="metaPageId" type="radio" name="meta-page" :value="p.pageId" />
              <span class="font-medium">{{ p.pageName }}</span>
              <span class="text-muted">
                {{ p.instagram ? `Instagram @${p.instagram.username}` : 'sem Instagram' }}
              </span>
            </label>
            <label
              v-if="selectedPage && !selectedPage.instagram"
              class="flex items-center gap-2 text-sm"
            >
              <input v-model="metaFacebookOnly" type="checkbox" />
              Vincular só o Facebook (esta Página não tem Instagram)
            </label>
          </fieldset>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="closeMeta">Cancelar</UButton>
          <UButton
            v-if="metaPages !== null"
            :loading="metaBusy"
            :disabled="!canConnectMeta"
            @click="connectMeta"
          >
            Conectar
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
