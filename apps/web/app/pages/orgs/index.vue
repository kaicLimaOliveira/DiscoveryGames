<script setup lang="ts">
useHead({ title: 'Organizações' })
const me = useMe()
const { orgs, refresh } = useOrgs()
await refresh()

const open = ref(false)
const form = reactive({ name: '', slug: '' })
const error = ref('')
const creating = ref(false)

function openCreate() {
  Object.assign(form, { name: '', slug: '' })
  error.value = ''
  open.value = true
}

async function create() {
  error.value = ''
  creating.value = true
  try {
    const org = await $fetch<{ id: string }>('/api/orgs', {
      method: 'POST',
      body: { name: form.name, ...(form.slug.trim() ? { slug: form.slug } : {}) },
    })
    await refresh()
    open.value = false
    await navigateTo(`/orgs/${org.id}/accounts`)
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">Organizações</h1>
      <UButton v-if="me?.isAdmin" @click="openCreate">Nova organização</UButton>
    </div>

    <p v-if="!orgs.length" class="text-muted">
      Você ainda não pertence a nenhuma organização.
      <template v-if="!me?.isAdmin">Peça acesso a um administrador.</template>
    </p>
    <ul v-else class="divide-y divide-default rounded-md border border-default">
      <li
        v-for="o in orgs"
        :key="o.id"
        data-testid="org-row"
        class="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
      >
        <div>
          <span class="font-medium">{{ o.name }}</span>
          <span class="ml-2 text-sm text-muted">{{ o.slug }}</span>
        </div>
        <div class="flex gap-3 text-sm">
          <NuxtLink :to="`/orgs/${o.id}/accounts`" class="text-primary underline">Contas</NuxtLink>
          <NuxtLink :to="`/orgs/${o.id}/settings`" class="text-primary underline">
            Configurações
          </NuxtLink>
        </div>
      </li>
    </ul>

    <UModal v-model:open="open" title="Nova organização">
      <template #body>
        <form id="create-org" class="space-y-4" @submit.prevent="create">
          <UAlert v-if="error" color="error" variant="subtle" :description="error" />
          <UFormField label="Nome" name="name">
            <UInput v-model="form.name" required class="w-full" />
          </UFormField>
          <UFormField label="Identificador (slug)" name="slug" help="Opcional; gerado do nome.">
            <UInput v-model="form.slug" class="w-full" />
          </UFormField>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="open = false">Cancelar</UButton>
          <UButton type="submit" form="create-org" :loading="creating">Criar</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
