import { hash, verify, type Algorithm } from '@node-rs/argon2'

// Algorithm é um const enum ambiente (inacessível com verbatimModuleSyntax); 2 = Argon2id.
const ARGON2ID = 2 as Algorithm

// Parâmetros OWASP para Argon2id.
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
}

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS)
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain)
  } catch {
    // Hash malformado: tratar como senha inválida.
    return false
  }
}
