<script setup lang="ts">
useHead({ title: 'Minha conta' })
const current = ref('')
const next = ref('')
const confirm = ref('')
const error = ref('')
const done = ref(false)
const loading = ref(false)

async function submit() {
  error.value = ''
  done.value = false
  if (next.value.length < 12) {
    error.value = 'A nova senha deve ter pelo menos 12 caracteres.'
    return
  }
  if (next.value !== confirm.value) {
    error.value = 'A confirmação não confere com a nova senha.'
    return
  }
  loading.value = true
  try {
    await $fetch('/api/auth/password', {
      method: 'POST',
      body: { current: current.value, next: next.value },
    })
    done.value = true
    current.value = next.value = confirm.value = ''
  } catch (err) {
    error.value = apiErrorMessage(err, 'Não foi possível trocar a senha.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-md space-y-4">
    <h1 class="text-2xl font-semibold">Minha conta</h1>
    <UCard>
      <template #header><h2 class="font-medium">Trocar senha</h2></template>
      <form class="space-y-4" @submit.prevent="submit">
        <UAlert v-if="error" color="error" variant="subtle" :description="error" />
        <UAlert
          v-if="done"
          color="success"
          variant="subtle"
          description="Senha alterada. Outras sessões foram encerradas."
        />
        <UFormField label="Senha atual" name="current">
          <UInput
            v-model="current"
            type="password"
            autocomplete="current-password"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Nova senha" name="next" help="Mínimo de 12 caracteres.">
          <UInput v-model="next" type="password" autocomplete="new-password" class="w-full" />
        </UFormField>
        <UFormField label="Confirmar nova senha" name="confirm">
          <UInput v-model="confirm" type="password" autocomplete="new-password" class="w-full" />
        </UFormField>
        <UButton type="submit" :loading="loading">Trocar senha</UButton>
      </form>
    </UCard>
  </div>
</template>
