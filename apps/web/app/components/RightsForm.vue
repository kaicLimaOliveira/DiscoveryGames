<script setup lang="ts">
const props = defineProps<{ orgId: string; partners: PartnerCreator[] }>()
const model = defineModel<RightsValue>({ required: true })

const BASES: RightsBasis[] = ['own', 'authorized', 'cc_license', 'clipper_program', 'none']

const uploading = ref(false)
const uploadError = ref('')

const partner = computed(() => props.partners.find((p) => p.id === model.value.partnerCreatorId))

function pickPartner(id: string) {
  model.value.partnerCreatorId = id
  const p = props.partners.find((x) => x.id === id)
  if (p) model.value.creatorName = p.name
}

async function attach(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadError.value = ''
  uploading.value = true
  try {
    model.value.evidenceKey = await uploadEvidence(props.orgId, file)
    model.value.evidenceName = file.name
  } catch (err) {
    model.value.evidenceKey = ''
    model.value.evidenceName = ''
    uploadError.value = apiErrorMessage(err, (err as Error).message)
  } finally {
    uploading.value = false
    input.value = ''
  }
}
</script>

<template>
  <div class="space-y-4">
    <fieldset class="space-y-2">
      <legend class="text-sm font-medium">Direitos sobre o vídeo</legend>
      <label
        v-for="b in BASES"
        :key="b"
        class="flex cursor-pointer items-start gap-2 rounded-md border border-default px-3 py-2 text-sm"
      >
        <input v-model="model.basis" type="radio" name="rights-basis" :value="b" class="mt-1" />
        <span>
          <span class="block font-medium">{{ RIGHTS_LABELS[b] }}</span>
          <span class="block text-muted">{{ RIGHTS_HELP[b] }}</span>
        </span>
      </label>
    </fieldset>

    <UCheckbox
      v-if="model.basis === 'own'"
      v-model="model.accepted"
      label="Declaro que o conteúdo é meu"
    />

    <template v-else-if="model.basis === 'authorized'">
      <UFormField v-if="partners.length" label="Criador parceiro">
        <select
          aria-label="Criador parceiro"
          class="w-full rounded-md border border-accented bg-default px-2 py-1.5 text-sm"
          :value="model.partnerCreatorId"
          @change="pickPartner(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Outro criador</option>
          <option v-for="p in partners" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </UFormField>
      <UFormField label="Nome do criador">
        <UInput v-model="model.creatorName" class="w-full" />
      </UFormField>
      <p v-if="partner?.authorizationUrl || partner?.authorizationKey" class="text-sm text-muted">
        A autorização registrada para este parceiro será usada como evidência.
      </p>
      <UFormField label="Link da autorização" help="Ou anexe um arquivo abaixo.">
        <UInput v-model="model.evidenceUrl" type="url" placeholder="https://" class="w-full" />
      </UFormField>
      <UFormField label="Anexo da autorização" help="PNG, JPEG ou PDF de até 10 MB.">
        <input
          type="file"
          aria-label="Anexo da autorização"
          accept="image/png,image/jpeg,application/pdf"
          class="text-sm"
          :disabled="uploading"
          @change="attach"
        />
      </UFormField>
      <p v-if="uploading" class="text-sm text-muted">Enviando anexo...</p>
      <p v-else-if="model.evidenceName" class="text-sm text-muted">
        Anexo: {{ model.evidenceName }}
      </p>
      <p v-if="uploadError" class="text-sm text-error">{{ uploadError }}</p>
    </template>

    <template v-else-if="model.basis === 'cc_license'">
      <UFormField label="Link da fonte">
        <UInput v-model="model.sourceUrl" type="url" placeholder="https://" class="w-full" />
      </UFormField>
      <UFormField label="Tipo de licença">
        <UInput v-model="model.licenseType" placeholder="CC BY 4.0" class="w-full" />
      </UFormField>
    </template>

    <UFormField
      v-else-if="model.basis === 'clipper_program'"
      label="Link do programa ou das regras"
    >
      <UInput v-model="model.programUrl" type="url" placeholder="https://" class="w-full" />
    </UFormField>

    <UAlert
      v-else
      color="warning"
      variant="subtle"
      description="Os cortes ficam só para estudo: não poderão ser publicados nem baixados."
    />

    <p class="text-sm text-muted">
      Sua declaração fica registrada com seu nome e a data. A responsabilidade por ela é sua.
    </p>
  </div>
</template>
