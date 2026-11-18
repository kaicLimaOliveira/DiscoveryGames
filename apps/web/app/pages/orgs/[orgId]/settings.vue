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
</script>

<template>
  <form class="max-w-3xl space-y-6" @submit.prevent="save">
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
        <UTextarea v-model="form.creditTemplate" :rows="2" class="w-full" :disabled="!canManage" />
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
</template>
