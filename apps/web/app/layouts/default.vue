<script setup lang="ts">
const me = useMe()
const { clear } = useUserSession()
const { orgs, activeOrgId, refresh: refreshOrgs } = useOrgs()

if (me.value?.stage === 'full' && !orgs.value.length) await refreshOrgs()
watch(
  () => me.value?.stage,
  (stage) => {
    if (stage === 'full') void refreshOrgs()
  },
)

async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
  await clear()
  me.value = null
  orgs.value = []
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen">
    <header class="border-b border-default">
      <UContainer class="flex h-14 items-center justify-between gap-4">
        <div class="flex items-center gap-6">
          <NuxtLink to="/" class="font-semibold">Central de Conteúdo</NuxtLink>
          <nav v-if="me?.stage === 'full'" class="flex items-center gap-4 text-sm">
            <OrgSwitcher />
            <template v-if="activeOrgId">
              <NuxtLink :to="`/orgs/${activeOrgId}/accounts`">Contas</NuxtLink>
              <NuxtLink :to="`/orgs/${activeOrgId}/sources`">Cortes</NuxtLink>
              <NuxtLink :to="`/orgs/${activeOrgId}/settings`">Configurações</NuxtLink>
            </template>
            <NuxtLink to="/orgs">Organizações</NuxtLink>
            <NuxtLink to="/account">Minha conta</NuxtLink>
            <NuxtLink v-if="me.isAdmin" to="/admin/users">Usuários</NuxtLink>
          </nav>
        </div>
        <div class="flex items-center gap-3">
          <UColorModeButton />
          <template v-if="me">
            <span class="hidden text-sm text-muted sm:inline">{{ me.email }}</span>
            <UButton color="neutral" variant="outline" size="sm" @click="logout">Sair</UButton>
          </template>
        </div>
      </UContainer>
    </header>
    <UContainer class="py-8">
      <slot />
    </UContainer>
  </div>
</template>
