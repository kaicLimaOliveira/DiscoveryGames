<script setup lang="ts">
const route = useRoute()
const { orgs, activeOrgId } = useOrgs()

async function change(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  if (!id) return
  const section = route.path.endsWith('/settings')
    ? 'settings'
    : route.path.includes('/sources')
      ? 'sources'
      : 'accounts'
  await navigateTo(`/orgs/${id}/${section}`)
}
</script>

<template>
  <select
    v-if="orgs.length"
    aria-label="Organização ativa"
    class="max-w-48 rounded-md border border-accented bg-default px-2 py-1 text-sm text-highlighted"
    :value="activeOrgId ?? ''"
    @change="change"
  >
    <option v-if="!orgs.some((o) => o.id === activeOrgId)" value="" disabled>Organização</option>
    <option v-for="o in orgs" :key="o.id" :value="o.id">{{ o.name }}</option>
  </select>
</template>
