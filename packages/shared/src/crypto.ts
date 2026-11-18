import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export interface SecretCipher {
  currentVersion: number
  encrypt(plain: string, aad: string): string
  decrypt(token: string, aad: string): string
  needsRotation(token: string): boolean
}

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const B64URL = /^[A-Za-z0-9_-]*$/

interface ParsedToken {
  version: number
  iv: Buffer
  tag: Buffer
  data: Buffer
}

function malformed(): Error {
  return new Error('Token cifrado malformado')
}

function parseToken(token: string, known?: Map<number, Buffer>): ParsedToken {
  if (typeof token !== 'string') throw malformed()
  const parts = token.split('.')
  if (parts.length !== 4) throw malformed()
  const [v, ivPart, tagPart, dataPart] = parts as [string, string, string, string]
  if (!/^[1-9]\d{0,8}$/.test(v)) throw malformed()
  if (known && !known.has(Number(v)))
    throw new Error(`Chave de cifragem com versão desconhecida: ${v}`)
  if (![ivPart, tagPart, dataPart].every((p) => B64URL.test(p))) throw malformed()
  const iv = Buffer.from(ivPart, 'base64url')
  const tag = Buffer.from(tagPart, 'base64url')
  const data = Buffer.from(dataPart, 'base64url')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw malformed()
  return { version: Number(v), iv, tag, data }
}

export function createCipher(keys: Map<number, Buffer>): SecretCipher {
  if (keys.size === 0) throw new Error('Nenhuma chave de cifragem informada')
  for (const [version, key] of keys) {
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`Versão de chave inválida: ${version}`)
    }
    if (key.length !== KEY_BYTES) {
      throw new Error(`A chave da versão ${version} deve ter ${KEY_BYTES} bytes`)
    }
  }
  const currentVersion = Math.max(...keys.keys())
  const currentKey = keys.get(currentVersion) as Buffer

  return {
    currentVersion,
    encrypt(plain, aad) {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv(ALGORITHM, currentKey, iv)
      cipher.setAAD(Buffer.from(aad))
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return [
        currentVersion,
        iv.toString('base64url'),
        tag.toString('base64url'),
        data.toString('base64url'),
      ].join('.')
    },
    decrypt(token, aad) {
      const { version, iv, tag, data } = parseToken(token, keys)
      const key = keys.get(version) as Buffer
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv)
        decipher.setAAD(Buffer.from(aad))
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
      } catch {
        throw new Error('Falha ao decifrar: token adulterado ou AAD incorreto')
      }
    },
    needsRotation(token) {
      return parseToken(token).version < currentVersion
    },
  }
}
