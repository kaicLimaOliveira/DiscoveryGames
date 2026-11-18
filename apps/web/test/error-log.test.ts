import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { OUTPUT_DIR } from './constants'
import { env } from './helpers'

interface LogLine {
  requestId?: string
  level?: number
  err?: { message?: string }
}

let child: ChildProcess | undefined
let output = ''

async function freePort(): Promise<number> {
  const srv = createServer()
  srv.listen(0, '127.0.0.1')
  await once(srv, 'listening')
  const { port } = srv.address() as { port: number }
  srv.close()
  await once(srv, 'close')
  return port
}

afterAll(() => {
  child?.kill()
})

it('erro lançado em middleware sai como linha JSON com requestId, sem stack em texto puro', async () => {
  const port = await freePort()
  child = spawn(process.execPath, [resolve(OUTPUT_DIR, 'server/index.mjs')], {
    env: {
      ...process.env,
      ...env,
      LOG_LEVEL: 'error',
      WEB_TEST_FAULT: '1',
      NITRO_PORT: String(port),
      NITRO_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout!.on('data', (d: Buffer) => (output += d.toString()))
  child.stderr!.on('data', (d: Buffer) => (output += d.toString()))

  const url = `http://127.0.0.1:${port}/api/health`
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(url)
      break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  const requestId = 'req-erro-nao-tratado-1'
  const res = await fetch(url, { headers: { 'x-test-fault': '1', 'x-request-id': requestId } })
  expect(res.status).toBe(500)
  expect(res.headers.get('x-request-id')).toBe(requestId)
  await new Promise((r) => setTimeout(r, 300))

  const lines = output.split('\n').filter(Boolean)
  const entries = lines
    .map((l) => {
      try {
        return JSON.parse(l) as LogLine
      } catch {
        return null
      }
    })
    .filter((j) => j?.requestId === requestId)
  // Uma única linha: o erro não é registrado duas vezes.
  expect(entries).toHaveLength(1)
  const entry = entries[0]
  expect(entry).toBeDefined()
  expect(entry!.level).toBe(50)
  expect(entry!.err?.message).toContain('falha injetada')
  // Sem console.error em texto puro do Nitro: nenhuma linha de stack fora do JSON.
  expect(output).not.toMatch(/^\s+at /m)
})
