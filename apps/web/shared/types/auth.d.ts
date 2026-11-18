import type { LoginStage } from '@central/core'

declare module '#auth-utils' {
  interface User {
    id: string
    name: string
    email: string
    stage: LoginStage
  }

  // Só no servidor: o nuxt-auth-utils remove `secure` de /api/_auth/session.
  interface SecureSessionData {
    sessionVersion: number
    pendingTotpSecret?: string
    lastSeenAt: number
  }
}

export {}
