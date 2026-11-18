export interface Me {
  id: string
  name: string
  email: string
  stage: 'full' | 'totp_pending' | 'totp_enroll'
  isAdmin: boolean
}

/** Usuário da sessão (servidor é a autoridade); atualizado pelo middleware `auth.global`. */
export const useMe = () => useState<Me | null>('me', () => null)

export function apiErrorMessage(err: unknown, fallback = 'Não foi possível concluir a ação.') {
  const e = err as { data?: { message?: string }; statusMessage?: string } | null
  return e?.data?.message ?? e?.statusMessage ?? fallback
}
