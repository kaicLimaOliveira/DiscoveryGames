const TYPES = ['image/png', 'image/jpeg', 'application/pdf']
const MAX_BYTES = 10 * 1024 * 1024

/** Anexo de evidência ou autorização: pede a URL ao servidor e envia direto ao storage. */
export async function uploadEvidence(orgId: string, file: File): Promise<string> {
  if (!TYPES.includes(file.type)) throw new Error('O anexo deve ser PNG, JPEG ou PDF.')
  if (file.size > MAX_BYTES) throw new Error('O anexo deve ter até 10 MB.')
  const { key, url } = await $fetch<{ key: string; url: string }>(
    `/api/orgs/${orgId}/evidence-upload`,
    { method: 'POST', body: { contentType: file.type } },
  )
  // O Content-Type do PUT precisa ser exatamente o pedido (a URL é assinada com ele).
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!res.ok) throw new Error('Não foi possível enviar o anexo.')
  return key
}
