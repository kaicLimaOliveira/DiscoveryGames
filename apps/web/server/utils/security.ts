import type { H3Event } from 'h3'
import { useWebConfig } from './config'

/**
 * Origens do storage: o navegador envia as partes do vídeo (PUT) e toca o original (GET) direto
 * nas URLs assinadas. Em estilo virtual-hosted o bucket vira subdomínio, por isso o curinga.
 */
function storageOrigins(): string[] {
  const { S3_ENDPOINT, S3_FORCE_PATH_STYLE } = useWebConfig()
  const url = new URL(S3_ENDPOINT)
  return S3_FORCE_PATH_STYLE ? [url.origin] : [url.origin, `${url.protocol}//*.${url.host}`]
}

// O Nuxt injeta um script inline com a configuração pública (window.__NUXT__), daí
// 'unsafe-inline' em script-src; o restante segue default-src 'self'.
function buildCsp(): string {
  const storage = storageOrigins().join(' ')
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${storage}`,
    `media-src 'self' blob: ${storage}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** Cabeçalhos de segurança de todas as respostas (inclusive as de erro da API). */
export function setSecurityHeaders(event: H3Event): void {
  const production = useWebConfig().NODE_ENV === 'production'
  setResponseHeaders(event, {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    // Em dev o HMR do Vite precisa de websocket e scripts próprios.
    ...(import.meta.dev ? {} : { 'Content-Security-Policy': buildCsp() }),
    ...(production ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  })
}
