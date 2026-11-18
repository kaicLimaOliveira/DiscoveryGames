# Runbook: CORS do bucket (Cloudflare R2)

O painel envia o vídeo **direto do navegador para o bucket**, por URLs assinadas (envio multipart, partes de 64 MiB), e toca o original no player da tela de Cortes pela mesma via. Sem CORS no bucket, o navegador bloqueia o `PUT`, ou o envia mas não consegue ler o `ETag` de cada parte, e o envio falha com "O armazenamento não devolveu o ETag".

## Regra de CORS

Aplicar no bucket (`S3_BUCKET`), com a origem do painel (`APP_ORIGIN`, sem barra no fim):

```json
[
  {
    "AllowedOrigins": ["https://<PANEL_DOMAIN>"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

- `PUT`: envio das partes do vídeo e dos anexos de evidência (PNG, JPEG ou PDF).
- `GET`: player do navegador (a URL assinada é de leitura).
- `ExposeHeaders: ETag`: obrigatório. O navegador só deixa o JavaScript ler o `ETag` da resposta se ele estiver exposto, e o servidor precisa dele para concluir o envio multipart.
- `AllowedHeaders: ["*"]`: o anexo de evidência vai com `Content-Type`, e o navegador faz a checagem prévia (`OPTIONS`) com esse cabeçalho.

Onde configurar: painel da Cloudflare, R2, o bucket, Settings, CORS Policy ❓ (confirmar o caminho no painel atual; a regra também pode ser aplicada pela API S3 `PutBucketCors` ou pelo `wrangler`). Não use `*` em `AllowedOrigins`.

## Como conferir

1. Checagem prévia, com uma URL assinada de parte (ou qualquer URL do bucket):

   ```bash
   curl -si -X OPTIONS "<url-assinada>" \
     -H "Origin: https://<PANEL_DOMAIN>" \
     -H "Access-Control-Request-Method: PUT"
   ```

   Esperado: `Access-Control-Allow-Origin: https://<PANEL_DOMAIN>` e `PUT` em `Access-Control-Allow-Methods`.
2. Fim a fim: no painel, **Cortes**, **Novo corte**, enviar um MP4 pequeno. A fonte deve aparecer como "Na fila". Se o envio falhar, abra as ferramentas do navegador (aba Rede): a resposta do `PUT` precisa trazer `Access-Control-Expose-Headers: ETag`.

## Outros pontos

- O painel já inclui a origem do storage (`S3_ENDPOINT`) em `connect-src` e `media-src` do `Content-Security-Policy`. Se o endpoint mudar, reinicie o `web`.
- O endpoint das URLs assinadas precisa ser alcançável pelo navegador (no R2, o endpoint da conta; num MinIO local, `localhost`).
- Os testes de E2E rodam contra um MinIO real, que aceita CORS de qualquer origem; a regra acima é só do R2 e continua **sem teste automático** ❓.
