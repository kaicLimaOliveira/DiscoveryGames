<script setup lang="ts">
useHead({ title: 'Central de Conteúdo', htmlAttrs: { lang: 'pt-BR' } })

// Sinaliza que a hidratação terminou (os testes E2E esperam por isto antes de interagir).
onMounted(() => {
  document.body.dataset.hydrated = '1'
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
