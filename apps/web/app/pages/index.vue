<script setup lang="ts">
useHead({ title: 'Início' })
const me = useMe()
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-2xl font-semibold">Fase 1 — fundação pronta</h1>
    <p v-if="me" class="text-muted">Olá, {{ me.name }}.</p>
    <ul class="list-disc space-y-1 pl-5">
      <li><NuxtLink to="/account" class="text-primary underline">Minha conta</NuxtLink></li>
      <li v-if="me?.isAdmin">
        <NuxtLink to="/admin/users" class="text-primary underline">Administrar usuários</NuxtLink>
      </li>
    </ul>
  </div>
</template>
