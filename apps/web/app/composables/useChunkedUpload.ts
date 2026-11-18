export interface UploadInit {
  partSize: number
  partCount: number
}

export interface UploadApi {
  presign(partNumbers: number[]): Promise<Array<{ partNumber: number; url: string }>>
  complete(parts: Array<{ partNumber: number; etag: string }>): Promise<void>
}

const PRESIGN_BATCH = 10
const MAX_ATTEMPTS = 3

export class UploadCancelled extends Error {
  constructor() {
    super('Envio cancelado.')
  }
}

/**
 * Envio multipart direto para o storage: partes em sequência, URLs pedidas em lotes de 10 e até
 * 3 tentativas por parte. O `ETag` de cada parte vem do header da resposta, o que exige
 * `ExposeHeaders: ETag` no CORS do bucket (docs/runbooks/storage-cors.md).
 * `progress` vai de 0 a 100.
 */
export function useChunkedUpload(file: File, init: UploadInit, api: UploadApi) {
  const progress = ref(0)
  let current: XMLHttpRequest | null = null
  let cancelled = false

  function putPart(url: string, body: Blob, onBytes: (loaded: number) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      current = xhr
      xhr.open('PUT', url)
      xhr.upload.onprogress = (e) => onBytes(e.loaded)
      xhr.onerror = () => reject(new Error('Falha de rede ao enviar o vídeo.'))
      xhr.onabort = () => reject(new UploadCancelled())
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`O armazenamento recusou a parte (HTTP ${xhr.status}).`))
          return
        }
        const etag = xhr.getResponseHeader('ETag')
        if (!etag) {
          reject(
            new Error(
              'O armazenamento não devolveu o ETag. Confira o CORS do bucket (ExposeHeaders).',
            ),
          )
          return
        }
        resolve(etag)
      }
      xhr.send(body)
    })
  }

  async function start(): Promise<void> {
    cancelled = false
    progress.value = 0
    const parts: Array<{ partNumber: number; etag: string }> = []
    const urls = new Map<number, string>()
    let doneBytes = 0

    for (let partNumber = 1; partNumber <= init.partCount; partNumber++) {
      const from = (partNumber - 1) * init.partSize
      const blob = file.slice(from, Math.min(from + init.partSize, file.size))
      let etag: string | undefined
      let lastError: unknown
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && etag === undefined; attempt++) {
        if (cancelled) throw new UploadCancelled()
        try {
          // Na repetição a URL é renovada: a anterior pode ter expirado.
          if (attempt > 1) urls.delete(partNumber)
          if (!urls.has(partNumber)) {
            const batch: number[] = []
            const last =
              attempt > 1 ? partNumber : Math.min(partNumber + PRESIGN_BATCH - 1, init.partCount)
            for (let n = partNumber; n <= last; n++) batch.push(n)
            for (const p of await api.presign(batch)) urls.set(p.partNumber, p.url)
          }
          etag = await putPart(urls.get(partNumber)!, blob, (loaded) => {
            progress.value = Math.min(99, Math.floor(((doneBytes + loaded) / file.size) * 100))
          })
        } catch (err) {
          if (err instanceof UploadCancelled || cancelled) throw new UploadCancelled()
          lastError = err
        }
      }
      if (etag === undefined) throw lastError
      parts.push({ partNumber, etag })
      doneBytes += blob.size
      progress.value = Math.min(99, Math.floor((doneBytes / file.size) * 100))
    }

    await api.complete(parts)
    progress.value = 100
  }

  function cancel(): void {
    cancelled = true
    current?.abort()
  }

  return { progress, start, cancel }
}
