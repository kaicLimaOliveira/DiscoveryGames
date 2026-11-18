<script setup lang="ts">
useHead({ title: 'Usuários' })

type OrganizationRole = 'viewer' | 'editor' | 'approver' | 'admin'
interface UserRow {
  id: string
  email: string
  name: string
  role: 'admin' | 'member'
  status: 'active' | 'disabled'
  totpEnabled: boolean
  memberships: Array<{ organizationId: string; role: OrganizationRole }>
}
interface Organization {
  id: string
  name: string
  slug: string
}

const ROLE_LABELS: Record<OrganizationRole, string> = {
  viewer: 'Leitor',
  editor: 'Editor',
  approver: 'Aprovador',
  admin: 'Administrador da organização',
}
const roles = Object.entries(ROLE_LABELS) as Array<[OrganizationRole, string]>

const { data: usersData, refresh: refreshUsers } = await useFetch<{ users: UserRow[] }>(
  '/api/admin/users',
)
const { data: orgsData } = await useFetch<{ organizations: Organization[] }>('/api/orgs')
const users = computed(() => usersData.value?.users ?? [])
const orgs = computed(() => orgsData.value?.organizations ?? [])

const { activeOrgId } = useOrgs()
const selectedOrganizationId = ref(
  orgs.value.find((o) => o.id === activeOrgId.value)?.id ?? orgs.value[0]?.id ?? '',
)
const error = ref('')
const notice = ref('')

function orgRole(user: UserRow): string {
  return user.memberships.find((m) => m.organizationId === selectedOrganizationId.value)?.role ?? ''
}

async function setOrganizationRole(user: UserRow, role: string) {
  error.value = ''
  const base = `/api/orgs/${selectedOrganizationId.value}/members/${user.id}`
  try {
    if (role) await $fetch(base, { method: 'PUT', body: { role } })
    else await $fetch(base, { method: 'DELETE' })
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
  await refreshUsers()
}

async function toggleStatus(user: UserRow) {
  error.value = ''
  try {
    await $fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      body: { status: user.status === 'active' ? 'disabled' : 'active' },
    })
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
  await refreshUsers()
}

// Criação
const open = ref(false)
const form = reactive({ name: '', email: '', password: '', globalRole: 'member', role: '' })
const formError = ref('')
const creating = ref(false)

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

function openCreate() {
  Object.assign(form, { name: '', email: '', password: '', globalRole: 'member', role: '' })
  formError.value = ''
  open.value = true
}

async function create() {
  formError.value = ''
  if (form.password.length < 12) {
    formError.value = 'A senha inicial deve ter pelo menos 12 caracteres.'
    return
  }
  creating.value = true
  try {
    const { id } = await $fetch<{ id: string }>('/api/admin/users', {
      method: 'POST',
      body: {
        name: form.name,
        email: form.email,
        password: form.password,
        globalRole: form.globalRole,
      },
    })
    if (form.role && selectedOrganizationId.value) {
      await $fetch(`/api/orgs/${selectedOrganizationId.value}/members/${id}`, {
        method: 'PUT',
        body: { role: form.role },
      })
    }
    notice.value = `Usuário ${form.email} criado. Senha inicial (exibida somente agora): ${form.password}`
    open.value = false
    await refreshUsers()
  } catch (err) {
    formError.value = apiErrorMessage(err)
  } finally {
    creating.value = false
  }
}

const selectClass =
  'w-full rounded-md border border-accented bg-default px-2 py-1.5 text-sm text-highlighted'
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">Usuários</h1>
      <UButton @click="openCreate">Novo usuário</UButton>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" :description="error" />
    <UAlert
      v-if="notice"
      color="success"
      variant="subtle"
      title="Usuário criado"
      :description="notice"
      close
      @update:open="notice = ''"
    />

    <div class="flex items-center gap-2 text-sm">
      <label for="org-filter">Organização (papéis exibidos):</label>
      <select id="org-filter" v-model="selectedOrganizationId" :class="[selectClass, 'max-w-xs']">
        <option v-if="!orgs.length" value="">Nenhuma organização cadastrada</option>
        <option v-for="b in orgs" :key="b.id" :value="b.id">{{ b.name }}</option>
      </select>
    </div>

    <div class="overflow-x-auto rounded-md border border-default">
      <table class="w-full text-left text-sm">
        <thead class="bg-elevated text-muted">
          <tr>
            <th class="px-3 py-2">Nome</th>
            <th class="px-3 py-2">E-mail</th>
            <th class="px-3 py-2">Perfil</th>
            <th class="px-3 py-2">2FA</th>
            <th class="px-3 py-2">Situação</th>
            <th class="px-3 py-2">Papel na organização</th>
            <th class="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id" data-testid="user-row" class="border-t border-default">
            <td class="px-3 py-2">{{ u.name }}</td>
            <td class="px-3 py-2">{{ u.email }}</td>
            <td class="px-3 py-2">{{ u.role === 'admin' ? 'Administrador' : 'Membro' }}</td>
            <td class="px-3 py-2">{{ u.totpEnabled ? 'Ativo' : 'Inativo' }}</td>
            <td class="px-3 py-2">
              <UBadge :color="u.status === 'active' ? 'success' : 'neutral'" variant="subtle">
                {{ u.status === 'active' ? 'Ativo' : 'Desativado' }}
              </UBadge>
            </td>
            <td class="px-3 py-2">
              <select
                :aria-label="`Papel de ${u.email} na organização`"
                :class="selectClass"
                :disabled="!selectedOrganizationId"
                :value="orgRole(u)"
                @change="setOrganizationRole(u, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">Sem acesso</option>
                <option v-for="[value, label] in roles" :key="value" :value="value">
                  {{ label }}
                </option>
              </select>
            </td>
            <td class="px-3 py-2 text-right">
              <UButton size="xs" color="neutral" variant="outline" @click="toggleStatus(u)">
                {{ u.status === 'active' ? 'Desativar' : 'Ativar' }}
              </UButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UModal v-model:open="open" title="Novo usuário">
      <template #body>
        <form id="create-user" class="space-y-4" @submit.prevent="create">
          <UAlert v-if="formError" color="error" variant="subtle" :description="formError" />
          <UFormField label="Nome" name="name">
            <UInput v-model="form.name" required class="w-full" />
          </UFormField>
          <UFormField label="E-mail" name="email">
            <UInput v-model="form.email" type="email" required class="w-full" />
          </UFormField>
          <UFormField label="Senha inicial" name="password" help="Mínimo de 12 caracteres.">
            <div class="flex gap-2">
              <UInput v-model="form.password" required class="w-full" />
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                @click="form.password = generatePassword()"
              >
                Gerar
              </UButton>
            </div>
          </UFormField>
          <div class="space-y-1">
            <label for="new-global-role" class="text-sm font-medium">Perfil global</label>
            <select id="new-global-role" v-model="form.globalRole" :class="selectClass">
              <option value="member">Membro</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <div class="space-y-1">
            <label for="new-org-role" class="text-sm font-medium">Papel na organização</label>
            <select id="new-org-role" v-model="form.role" :class="selectClass">
              <option value="">Sem acesso</option>
              <option v-for="[value, label] in roles" :key="value" :value="value">
                {{ label }}
              </option>
            </select>
            <p class="text-xs text-muted">Aplicado à organização selecionada na listagem.</p>
          </div>
        </form>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="open = false">Cancelar</UButton>
          <UButton type="submit" form="create-user" :loading="creating">Criar</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
