import { spawn } from 'node:child_process'

export class MediaToolError extends Error {
  constructor(
    message: string,
    readonly code: 'TIMEOUT' | 'EXIT',
    readonly stderrTail: string,
  ) {
    super(message)
    this.name = 'MediaToolError'
  }
}

const MAX_STDERR_CHARS = 256 * 1024

function tail(text: string, lines = 20): string {
  return text.split(/\r?\n/).filter(Boolean).slice(-lines).join('\n')
}

/** Executa um binário por `spawn` (sem shell). Mata o processo no timeout ou no abort. */
export function runTool(
  bin: string,
  args: string[],
  opts: { timeoutMs: number; cwd?: string; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let stderr = ''
    let failure: MediaToolError | null = null

    const kill = (message: string, code: 'TIMEOUT' | 'EXIT') => {
      failure ??= new MediaToolError(message, code, tail(stderr))
      child.kill('SIGKILL')
    }
    const timer = setTimeout(
      () => kill(`Tempo esgotado (${opts.timeoutMs} ms) em ${bin}`, 'TIMEOUT'),
      opts.timeoutMs,
    )
    const onAbort = () => kill('Execução cancelada', 'EXIT')
    if (opts.signal?.aborted) onAbort()
    else opts.signal?.addEventListener('abort', onAbort, { once: true })

    const finish = () => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-MAX_STDERR_CHARS)
    })
    child.on('error', (err) => {
      finish()
      reject(new MediaToolError(`Falha ao iniciar ${bin}: ${err.message}`, 'EXIT', tail(stderr)))
    })
    child.on('close', (exitCode) => {
      finish()
      if (failure) return reject(failure)
      const stdout = Buffer.concat(out).toString()
      if (exitCode === 0) return resolve({ stdout, stderr })
      reject(new MediaToolError(`${bin} terminou com código ${exitCode}`, 'EXIT', tail(stderr)))
    })
  })
}
