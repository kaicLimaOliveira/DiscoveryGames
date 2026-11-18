<script setup lang="ts">
useHead({ title: 'Configurações' })

interface OrgDetail {
  id: string
  name: string
  timezone: string
  locale: string
  tags: string[]
  voiceGuide: string
  fixedHashtags: string[]
  creditTemplate: string
  clipDefaults: { targetMin: number; targetMax: number; minSec: number; maxSec: number }
  aiMonthlyBudgetUsd: number
}

const route = useRoute()
const orgId = computed(() => String(route.params.orgId))
const canManage = useCanManageOrg(orgId)
const { refresh: refreshOrgs } = useOrgs()
const requestFetch = useRequestFetch()
const { data: org } = await useAsyncData(
  () => `org-${orgId.value}`,
  () => requestFetch<OrgDetail>(`/api/orgs/${orgId.value}`),
  { watch: [orgId] },
)

function toForm(o: OrgDetail | null | undefined) {
  return {
    name: o?.name ?? '',
    timezone: o?.timezone ?? '',
    locale: o?.locale ?? '',
    voiceGuide: o?.voiceGuide ?? '',
    tags: [...(o?.tags ?? [])],
    fixedHashtags: [...(o?.fixedHashtags ?? [])],
    creditTemplate: o?.creditTemplate ?? '',
    targetMin: String(o?.clipDefaults.targetMin ?? ''),
    targetMax: String(o?.clipDefaults.targetMax ?? ''),
    minSec: String(o?.clipDefaults.minSec ?? ''),
    maxSec: String(o?.clipDefaults.maxSec ?? ''),
    aiMonthlyBudgetUsd: String(o?.aiMonthlyBudgetUsd ?? ''),
  }
}

const form = reactive(toForm(org.value))
watch(org, (o) => Object.assign(form, toForm(o)))

const error = ref('')
const saved = ref(false)
const saving = ref(false)
const fieldErrors = ref<Record<string, string>>({})

const FIELD_MESSAGE = 'Valor inválido.'
// Rótulo do campo do servidor (data.fields) para o campo do formulário.
function fieldError(...paths: string[]): string | undefined {
  return paths.map((p) => fieldErrors.value[p]).find(Boolean)
}

async function save() {
  error.value = ''
  saved.value = false
  fieldErrors.value = {}
  saving.value = true
  try {
    await $fetch(`/api/orgs/${orgId.value}`, {
      method: 'PATCH',
      body: {
        name: form.name,
        timezone: form.timezone,
        locale: form.locale,
        voiceGuide: form.voiceGuide,
        tags: form.tags,
        fixedHashtags: form.fixedHashtags,
        creditTemplate: form.creditTemplate,
        clipDefaults: {
          targetMin: Number(form.targetMin),
          targetMax: Number(form.targetMax),
          minSec: Number(form.minSec),
          maxSec: Number(form.maxSec),
        },
        aiMonthlyBudgetUsd: Number(form.aiMonthlyBudgetUsd),
      },
    })
    saved.value = true
    await Promise.all([refreshNuxtData(), refreshOrgs()])
  } catch (err) {
    const fields = (err as { data?: { data?: { fields?: string[] }; fields?: string[] } }).data
    const list = fields?.fields ?? fields?.data?.fields ?? []
    fieldErrors.value = Object.fromEntries(list.map((f) => [f, FIELD_MESSAGE]))
    error.value = apiErrorMessage(err)
  } finally {
    saving.value = false
  }
}

// Criadores parceiros: a lista é de todos os membros; só o administrador altera.
const { data: partnerData, refresh: refreshPartners } = await useAsyncData(
  () => `partners-${orgId.value}`,
  () =>
    serverApi()<{ partnerCreators: PartnerCreator[] }>(`/api/orgs/${orgId.value}/partner-creators`),
  { watch: [orgId] },
)
const partners = computed(() => partnerData.value?.partnerCreators ?? [])
const partnerOpen = ref(false)
const partnerBusy = ref(false)
const partnerError = ref('')
const partnerForm = reactive({
  name: '',
  channels: '',
  authorizationUrl: '',
  authorizationKey: '',
  attachmentName: '',
})

function openPartner() {
  Object.assign(partnerForm, {
    name: '',
    channels: '',
    authorizationUrl: '',
    authorizationKey: '',
    attachmentName: '',
  })
  partnerError.value = ''
  partnerOpen.value = true
}

async function attachPartner(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  partnerError.value = ''
  try {
    partnerForm.authorizationKey = await uploadEvidence(orgId.value, file)
    partnerForm.attachmentName = file.name
  } catch (err) {
    partnerForm.authorizationKey = ''
    partnerForm.attachmentName = ''
    partnerError.value = apiErrorMessage(err, (err as Error).message)
  } finally {
    input.value = ''
  }
}

async function addPartner() {
  partnerError.value = ''
  partnerBusy.value = true
  try {
    await api(`/api/orgs/${orgId.value}/partner-creators`, {
      method: 'POST',
      body: {
        name: partnerForm.name.trim(),
        channels: partnerForm.channels
          .split(/[,\n]/)
          .map((c) => c.trim())
          .filter(Boolean),
        authorizationUrl: partnerForm.authorizationUrl.trim() || null,
        authorizationKey: partnerForm.authorizationKey || null,
      },
    })
    partnerOpen.value = false
    await refreshPartners()
  } catch (err) {
    partnerError.value = apiErrorMessage(err)
  } finally {
    partnerBusy.value = false
  }
}

async function removePartner(p: PartnerCreator) {
  if (!window.confirm(`Remover o criador parceiro ${p.name}?`)) return
  partnerError.value = ''
  try {
    await api(`/api/orgs/${orgId.value}/partner-creators/${p.id}`, { method: 'DELETE' })
  } catch (err) {
    partnerError.value = apiErrorMessage(err)
  }
  await refreshPartners()
}
</script>

<template>
  <div class="max-w-3xl space-y-10">
    <form class="space-y-6" @submit.prevent="save">
      <h1 class="text-2xl font-semibold">Configurações</h1>

      <UAlert v-if="error" color="error" variant="subtle" :description="error" />
      <UAlert v-if="saved" color="success" variant="subtle" description="Configurações salvas." />

      <fieldset :disabled="!canManage" class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField label="Nome" name="name" :error="fieldError('name')" class="sm:col-span-3">
            <UInput v-model="form.name" class="w-full" :disabled="!canManage" />
          </UFormField>
          <UFormField label="Fuso horário" name="timezone" :error="fieldError('timezone')">
            <UInput v-model="form.timezone" class="w-full" :disabled="!canManage" />
          </UFormField>
          <UFormField label="Idioma" name="locale" :error="fieldError('locale')">
            <UInput v-model="form.locale" class="w-full" :disabled="!canManage" />
          </UFormField>
        </div>

        <UFormField label="Guia de voz" name="voiceGuide" :error="fieldError('voiceGuide')">
          <UTextarea v-model="form.voiceGuide" :rows="4" class="w-full" :disabled="!canManage" />
        </UFormField>

        <TagsField
          v-model="form.tags"
          label="Tags"
          name="tags"
          :error="fieldError('tags')"
          :disabled="!canManage"
        />
        <TagsField
          v-model="form.fixedHashtags"
          label="Hashtags fixas"
          name="fixedHashtags"
          :error="fieldError('fixedHashtags')"
          :disabled="!canManage"
        />

        <UFormField
          label="Modelo de créditos"
          name="creditTemplate"
          :error="fieldError('creditTemplate')"
        >
          <UTextarea
            v-model="form.creditTemplate"
            :rows="2"
            class="w-full"
            :disabled="!canManage"
          />
        </UFormField>

        <h2 class="pt-2 font-medium">Cortes</h2>
        <div class="grid gap-4 sm:grid-cols-4">
          <UFormField
            label="Quantidade mínima"
            name="targetMin"
            :error="fieldError('clipDefaults', 'clipDefaults.targetMin')"
          >
            <UInput v-model="form.targetMin" type="number" class="w-full" :disabled="!canManage" />
          </UFormField>
          <UFormField
            label="Quantidade máxima"
            name="targetMax"
            :error="fieldError('clipDefaults', 'clipDefaults.targetMax')"
          >
            <UInput v-model="form.targetMax" type="number" class="w-full" :disabled="!canManage" />
          </UFormField>
          <UFormField
            label="Duração mínima (s)"
            name="minSec"
            :error="fieldError('clipDefaults', 'clipDefaults.minSec')"
          >
            <UInput v-model="form.minSec" type="number" class="w-full" :disabled="!canManage" />
          </UFormField>
          <UFormField
            label="Duração máxima (s)"
            name="maxSec"
            :error="fieldError('clipDefaults', 'clipDefaults.maxSec')"
          >
            <UInput v-model="form.maxSec" type="number" class="w-full" :disabled="!canManage" />
          </UFormField>
        </div>

        <UFormField
          label="Orçamento mensal de IA (US$)"
          name="aiMonthlyBudgetUsd"
          :error="fieldError('aiMonthlyBudgetUsd')"
          class="max-w-xs"
        >
          <UInput
            v-model="form.aiMonthlyBudgetUsd"
            type="number"
            step="0.01"
            class="w-full"
            :disabled="!canManage"
          />
        </UFormField>
      </fieldset>

      <UButton v-if="canManage" type="submit" :loading="saving">Salvar</UButton>
      <p v-else class="text-sm text-muted">
        Somente administradores da organização podem alterar as configurações.
      </p>
    </form>

    <section class="space-y-3">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-lg font-semibold">Criadores parceiros</h2>
        <UButton v-if="canManage" size="sm" @click="openPartner">Adicionar</UButton>
      </div>
      <p class="text-sm text-muted">
        Criadores que autorizaram o uso dos vídeos deles. A autorização registrada vale como
        evidência ao declarar direitos.
      </p>
      <UAlert
        v-if="partnerError && !partnerOpen"
        color="error"
        variant="subtle"
        :description="partnerError"
      />
      <p v-if="!partners.length" class="text-sm text-muted">Nenhum criador parceiro.</p>
      <ul v-else class="divide-y divide-default rounded-lg border border-default">
        <li
          v-for="p in partners"
          :key="p.id"
          data-testid="partner-row"
          class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
        >
          <div>
            <span class="font-medium">{{ p.name }}</span>
            <span v-if="p.channels.length" class="ml-2 text-muted">{{
              p.channels.join(', ')
            }}</span>
            <span v-if="p.authorizationUrl || p.authorizationKey" class="ml-2 text-muted">
              · autorização registrada
            </span>
          </div>
          <UButton
            v-if="canManage"
            size="xs"
            color="error"
            variant="outline"
            @click="removePartner(p)"
          >
            Remover
          </UButton>
        </li>
      </ul>

      <UModal v-model:open="partnerOpen" title="Adicionar criador parceiro">
        <template #body>
          <form id="add-partner" class="space-y-4" @submit.prevent="addPartner">
            <UAlert
              v-if="partnerError"
              color="error"
              variant="subtle"
              :description="partnerError"
            />
            <UFormField label="Nome do criador">
              <UInput v-model="partnerForm.name" required class="w-full" />
            </UFormField>
            <UFormField label="Canais" help="Separe por vírgula (links ou @).">
              <UInput v-model="partnerForm.channels" class="w-full" />
            </UFormField>
            <UFormField label="Link da autorização" help="Ou anexe um arquivo abaixo.">
              <UInput
                v-model="partnerForm.authorizationUrl"
                type="url"
                placeholder="https://"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Anexo da autorização" help="PNG, JPEG ou PDF de até 10 MB.">
              <input
                type="file"
                aria-label="Anexo da autorização"
                accept="image/png,image/jpeg,application/pdf"
                class="text-sm"
                @change="attachPartner"
              />
            </UFormField>
            <p v-if="partnerForm.attachmentName" class="text-sm text-muted">
              Anexo: {{ partnerForm.attachmentName }}
            </p>
          </form>
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton color="neutral" variant="outline" @click="partnerOpen = false"
              >Cancelar</UButton
            >
            <UButton type="submit" form="add-partner" :loading="partnerBusy">Adicionar</UButton>
          </div>
        </template>
      </UModal>
    </section>
  </div>
</template>
