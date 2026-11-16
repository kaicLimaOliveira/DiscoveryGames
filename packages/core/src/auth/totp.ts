import { Secret, TOTP } from 'otpauth'

const PERIOD_S = 30
const PERIOD_MS = PERIOD_S * 1000

function totpFor(secret: string, label = 'OTPAuth', issuer = ''): TOTP {
  return new TOTP({
    issuer,
    label,
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD_S,
  })
}

/** Segredo TOTP de 20 bytes, em base32. */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

export function totpUri(secret: string, label: string, issuer: string): string {
  return totpFor(secret, label, issuer).toString()
}

/**
 * Valida o código TOTP (janela ±1) e devolve o step correspondente.
 * Anti-replay: recusa qualquer step menor ou igual a `lastUsedStep`.
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastUsedStep: bigint | null,
  now: Date = new Date(),
): { ok: true; step: bigint } | { ok: false } {
  if (!/^[0-9]{6}$/.test(code)) return { ok: false }
  const timestamp = now.getTime()
  if (!Number.isFinite(timestamp)) return { ok: false }
  let delta: number | null
  try {
    delta = totpFor(secret).validate({ token: code, timestamp, window: 1 })
  } catch {
    // Segredo base32 malformado: tratar como código inválido.
    return { ok: false }
  }
  if (delta === null) return { ok: false }
  const step = BigInt(Math.floor(timestamp / PERIOD_MS) + delta)
  if (lastUsedStep !== null && step <= lastUsedStep) return { ok: false }
  return { ok: true, step }
}
