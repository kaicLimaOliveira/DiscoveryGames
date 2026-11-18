<script setup lang="ts">
useHead({ title: 'Início' })
const { orgs, refresh } = useOrgs()
await refresh()
await navigateTo(orgs.value[0] ? `/orgs/${orgs.value[0].id}/accounts` : '/orgs', { replace: true })
</script>

<template>
  <p class="text-muted">Carregando…</p>
</template>
