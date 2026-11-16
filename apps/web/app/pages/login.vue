<script setup lang="ts">
useHead({ title: 'Entrar' })
const { fetch: refreshSession } = useUserSession()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    const { stage } = await $fetch<{ stage: string }>('/api/auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    })
    await refreshSession()
    await navigateTo(stage === 'full' ? '/' : '/2fa')
  } catch (err) {
    error.value = apiErrorMessage(err, 'Não foi possível entrar.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-sm">
    <UCard>
      <template #header><h1 class="text-lg font-semibold">Entrar</h1></template>
      <form class="space-y-4" @submit.prevent="submit">
        <UAlert v-if="error" color="error" variant="subtle" :description="error" />
        <UFormField label="E-mail" name="email">
          <UInput v-model="email" type="email" autocomplete="username" required class="w-full" />
        </UFormField>
        <UFormField label="Senha" name="password">
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="w-full"
          />
        </UFormField>
        <UButton type="submit" block :loading="loading">Entrar</UButton>
      </form>
    </UCard>
  </div>
</template>
