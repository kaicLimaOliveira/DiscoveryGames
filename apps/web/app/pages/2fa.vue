<script setup lang="ts">
import QRCode from 'qrcode'

useHead({ title: 'Verificação em duas etapas' })
const { fetch: refreshSession, clear } = useUserSession()
const me = useMe()
const enrolling = computed(() => me.value?.stage === 'totp_enroll')

const code = ref('')
const error = ref('')
const loading = ref(false)
const qr = ref('')
const secret = ref('')

onMounted(async () => {
  if (!enrolling.value) return
  try {
    const { uri } = await $fetch<{ uri: string }>('/api/auth/totp/enroll-start', {
      method: 'POST',
    })
    secret.value = new URL(uri).searchParams.get('secret') ?? ''
    qr.value = await QRCode.toDataURL(uri, { width: 200, margin: 1 })
  } catch (err) {
    error.value = apiErrorMessage(err, 'Não foi possível iniciar o cadastro do 2FA.')
  }
})

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await $fetch(enrolling.value ? '/api/auth/totp/enroll-confirm' : '/api/auth/totp/verify', {
      method: 'POST',
      body: { code: code.value.trim() },
    })
    await refreshSession()
    await navigateTo('/')
  } catch (err) {
    error.value = apiErrorMessage(err, 'Código inválido.')
  } finally {
    loading.value = false
  }
}

async function cancel() {
  await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
  await clear()
  await navigateTo('/login')
}
</script>

<template>
  <div class="mx-auto max-w-sm">
    <UCard>
      <template #header>
        <h1 class="text-lg font-semibold">
          {{ enrolling ? 'Configurar verificação em duas etapas' : 'Verificação em duas etapas' }}
        </h1>
      </template>
      <form class="space-y-4" @submit.prevent="submit">
        <UAlert v-if="error" color="error" variant="subtle" :description="error" />
        <template v-if="enrolling">
          <p class="text-sm text-muted">
            Leia o QR code no aplicativo autenticador (ou digite a chave manualmente) e informe o
            código gerado.
          </p>
          <div class="flex justify-center">
            <img v-if="qr" :src="qr" alt="QR code" width="200" height="200" />
          </div>
          <div v-if="secret" class="text-sm">
            <span class="text-muted">Chave para digitação manual:</span>
            <code data-testid="totp-secret" class="block break-all font-mono">{{ secret }}</code>
          </div>
        </template>
        <p v-else class="text-sm text-muted">
          Informe o código do aplicativo autenticador para continuar.
        </p>
        <UFormField label="Código de 6 dígitos" name="code">
          <UInput
            v-model="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            required
            class="w-full"
          />
        </UFormField>
        <UButton type="submit" block :loading="loading">
          {{ enrolling ? 'Confirmar' : 'Verificar' }}
        </UButton>
        <UButton type="button" block color="neutral" variant="link" @click="cancel">
          Cancelar e sair
        </UButton>
      </form>
    </UCard>
  </div>
</template>
