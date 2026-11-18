# Fase 3 — Cortador: análise e candidatos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** um membro da organização envia um vídeo longo (MP4, ou link do YouTube quando habilitado), declara os direitos, e a central analisa o vídeo (ffprobe, transcrição, sinais técnicos, quadros, Claude) e mostra cortes candidatos com nota, motivo, título, legendas por rede e layout sugerido, que a pessoa aceita, rejeita ou ajusta.

**Architecture:** dois pacotes novos: `@central/media` (FFmpeg/ffprobe via `spawn`, sem shell) e `@central/ai` (`Transcriber` com Groq, `LlmProvider` com Anthropic, prompt versionado, custo). O `@central/core` ganha os serviços de fontes, direitos, criadores parceiros, candidatos e orçamento. O worker ganha os jobs `source.analyze` e `source.download`. O web ganha upload multipart direto ao storage (URLs pré-assinadas), as rotas `/api/orgs/:orgId/sources/**` e as telas "Cortes". Renderização é a Fase 4 e publicação a Fase 5: aqui "aceitar" só muda o estado do candidato.

**Tech Stack:** a da Fase 2 (pnpm, TypeScript ~6.0.3, Nuxt 4, Prisma 7.10.1, pg-boss 12.38.2, zod 4.6.7, Vitest 5, Testcontainers) mais `ffmpeg-static` 5.3.0, `ffprobe-static` 3.1.0, `@anthropic-ai/sdk` 1.10.0, `@aws-sdk/s3-request-presigner` 3.1169.0 (mesma versão do `@aws-sdk/client-s3` já usado).

**Spec:** `docs/superpowers/specs/2026-11-17-organizacoes-e-cortador-design.md` (§3, §5.1–§5.3, §5.4.1, §6, §7, §10, §11). Apoio: ADR 0008 (cortador híbrido), ADR 0010 (trava de direitos), `docs/09-estrategia-ia.md`, `docs/10-pipeline-audiovisual.md`.

## Global Constraints

- Limites de entrada: vídeo de até **2 h** e **4 GB**; no máximo **1 job de análise por vez** e **1 de download por vez** (spec §3).
- **MP4 é o caminho principal e garantido.** O link do YouTube é conveniência que "pode falhar"; quando falha, a UI pede o MP4 (spec §3, §8).
- **O original nunca é alterado.** O `sha256` do original é calculado na ingestão e guardado no `MediaAsset` (spec §5.4, §11).
- Declarações de direitos: `own` (aceite do usuário), `authorized` (nome do criador + evidência: anexo ou link), `cc_license` (link da fonte + tipo de licença), `clipper_program` (link do programa ou das regras), `none` (gera candidatos para estudo, nunca publica) (spec §5.2).
- **Link do YouTube com `none` é recusado antes do download** (spec §5.2).
- **Mudança de declaração** é permitida, exige a evidência da nova categoria, fica versionada (histórico preservado) e é auditada (spec §5.2).
- Declaração e evidência vão para a auditoria: quem declarou e quando (spec §5.2).
- Candidato: início e fim, nota de gancho **0 a 100**, motivo em uma frase, título, legenda por rede, hashtags e layout sugerido entre `face`, `center`, `game_facecam`, `blur_fit` (spec §5.3, §5.4).
- Parâmetros por pedido: quantidade alvo de cortes (padrão **5 a 10**), faixa de duração (padrão **30 a 90 s**) e idioma; os padrões vêm de `Organization.clipDefaults` e `Organization.locale` (spec §5.3).
- Vídeo sem fala gera transcrição vazia, tratada como **sinal, não erro** (spec §5.3).
- Saída da IA validada por schema; chamadas que falham são repetidas **com limite** (spec §5.3).
- Custo: cada chamada de IA e de transcrição vai para o `CostLedger`. Orçamento mensal `aiMonthlyBudgetUsd` (padrão **US$ 50**) cobre Claude e Groq; alerta em **80%**; se a estimativa de uma nova análise passar do saldo, a análise é **bloqueada**; análises em andamento terminam (spec §5.3).
- Transcrição: Groq `whisper-large-v3-turbo` atrás da interface `Transcriber` (spec §5.3, docs/04).
- Prompts versionados em `packages/ai/prompts/<tarefa>/v<N>.md`; `promptVersion` gravado em cada `AiRun` (docs/09 §4).
- FFmpeg sempre por `spawn` com array de argumentos (nunca shell, nunca `fluent-ffmpeg`); diretório de scratch por job, apagado em `finally` (docs/04 §6, docs/10 §10).
- Ajustar início e fim de um candidato **não chama a IA de novo** (spec §5.1).
- Uma organização nunca vê nem altera fontes ou candidatos de outra; acesso por ID de outra organização responde **404** (Fase 2, `requireOrgAccess`).
- Chaves de API (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`) só existem no worker e nunca aparecem em logs nem em respostas.
- Textos de interface e mensagens de erro em pt-BR.
- Não inventar endpoints: o que não está confirmado na documentação oficial fica marcado ❓ no código (comentário) e em `docs/07-integracoes` ou `docs/09`.

## Review Focus

1. **Upload interrompido ou inconsistente** (aba fechada no meio, `complete` com partes faltando, objeto final acima de 4 GB, `complete` chamado duas vezes): a fonte fica em `awaiting_upload` ou recebe 422 com mensagem clara, o multipart é abortado quando inválido e a segunda chamada é idempotente. Teste em Task 7.
2. **Vídeo sem faixa de áudio** (gameplay muda): a análise não chama o Groq, grava transcrição vazia e gera candidatos só com sinais e quadros. Teste em Task 9.
3. **Retry do job depois de falha no meio** (Groq caiu depois da transcrição salva, worker reiniciou): a retomada não duplica `CostLedger`, `Transcript` nem candidatos, e reaproveita a transcrição e o `AiRun` já pagos. Teste em Task 9.
4. **IA devolvendo candidatos ruins** (fora da duração do vídeo, fora da faixa de segundos, sobrepostos, mais que o alvo): são filtrados de forma determinística; se nenhum sobrar depois das tentativas, a fonte vai para `failed` com mensagem, e o custo gasto fica registrado. Teste em Task 6.
5. **Acesso cruzado por ID** (membro da org A abre `/api/orgs/A/sources/<id da org B>` ou altera candidato de B): 404, sem revelar existência. Teste em Task 11.

---

## Decisões do redator para esta fase [call]

Registradas aqui para o dono revisar. Cada uma diz o custo se estiver errada.

- **R1 FFmpeg por `ffmpeg-static`/`ffprobe-static`**, com override por `FFMPEG_PATH`/`FFPROBE_PATH`. Funciona igual no Windows do dono, no CI e na imagem do worker, com versão fixada. Custo se errado: trocar por binário do apt na imagem (uma linha no Dockerfile).
- **R2 Upload multipart direto ao storage** com partes de **64 MiB** (4 GB = 64 partes), URLs pré-assinadas de 1 h, envio sequencial com até 3 tentativas por parte. Exige CORS no bucket expondo `ETag` (runbook). Custo se errado: upload grande menos robusto ou mais lento.
- **R3 Orçamento por mês-calendário UTC.** Custo se errado: virada de mês com algumas horas de diferença para o fuso da organização.
- **R4 Checagem de orçamento no worker, depois do ffprobe e antes da transcrição** (só aí a duração é conhecida). Se a estimativa passar do saldo, a fonte vai para `blocked_budget` e pode ser reenfileirada com "Tentar de novo". Custo se errado: nenhum gasto indevido; só o momento do bloqueio.
- **R5 Mudar a declaração de direitos exige `publication.approve`** (aprovador ou admin), porque libera publicação. Criar a fonte com a declaração inicial exige `content.edit`. Criadores parceiros: `settings.manage`. Custo se errado: editor precisa pedir ao aprovador.
- **R6 Sem fallback de transcrição nesta fase.** O fallback previsto em docs/04 (`gpt-4o-mini-transcribe`) ❓ não tem timestamp por palavra; a interface aceita uma cadeia, mas só o Groq é implementado. Registrado em docs/21. Custo se errado: uma queda do Groq atrasa análises (os retries cobrem quedas curtas).
- **R7 Link do YouTube atrás de `YTDLP_ENABLED` (padrão desligado)**, com `yt-dlp` de versão fixada na imagem. O dono liga quando quiser, sabendo do risco de termos e de bloqueio de IP (spec §3). Custo se errado: o botão de link fica oculto até ligar a chave.
- **R8 Player do candidato** usa URL pré-assinada do original (1 h, `Content-Disposition: inline`) com início e fim no player. Para fonte `none` isso não fura a trava: o original foi enviado pelo próprio usuário, e o bloqueio de download de **cortes** (spec §5.2) nasce na Fase 4 junto com os cortes.
- **R9 Créditos ao criador e hashtags fixas** são aplicados na publicação (Fase 5), sobre a legenda gerada aqui. A IA recebe tags e guia de voz; não recebe a regra de crédito.
- **R10 Limiares e amostragem fixados** (spec §12 deixa ao construtor): corte de cena `scene > 0.4`; pico de volume = janela de 1 s com RMS ≥ percentil 90 do vídeo **e** ≥ −30 dBFS; movimento = média do `scene` por janela de 5 s; quadros a cada `max(10 s, duração/40)`, teto **40**, 768 px no maior lado, JPEG. Custo se errado: ajuste de constantes em `packages/media/src/signals.ts`/`frames.ts`.

---

## File Structure

```
packages/db/prisma/schema.prisma                         + enums e modelos da Fase 3
packages/db/prisma/migrations/20261118150000_cutter/     migração
packages/storage/src/s3.ts                               multipart, presign, download/upload, head, delete
packages/media/                                          NOVO pacote
  src/bin.ts            caminhos do ffmpeg/ffprobe
  src/run.ts            spawn com timeout e stderr resumido
  src/probe.ts          ffprobe → MediaProbe normalizado
  src/audio.ts          áudio em blocos de 10 min (ogg 16 kHz mono)
  src/signals.ts        picos de volume, cortes de cena, movimento
  src/frames.ts         amostragem de quadros
  src/hash.ts           sha256 de arquivo em stream
  test/fixtures.ts      gera vídeos de teste com o próprio ffmpeg
packages/ai/                                             NOVO pacote
  src/transcriber.ts    interface Transcriber + GroqTranscriber
  src/llm.ts            interface LlmProvider + AnthropicProvider
  src/pricing.ts        tabela de preços e estimativa de custo
  src/select-clips.ts   tarefa select_clips (schema, prompt, pós-validação)
  prompts/select-clips/v1.md
packages/core/src/
  cutter/rights.ts              validação de declaração, assertPublishable
  cutter/partner-creator-service.ts
  cutter/source-service.ts      criar fonte (upload/link), completar upload, listar, mudar direitos, reenfileirar
  cutter/candidate-service.ts   listar, aceitar, rejeitar, ajustar, URL do player
  cutter/budget.ts              gasto do mês, estimativa, alerta 80%
apps/worker/src/
  config.ts                     env do worker
  handlers/source-analyze.ts    pipeline de análise
  handlers/source-download.ts   download por link (yt-dlp)
  scratch.ts                    diretório por job
apps/web/server/api/orgs/[orgId]/sources/**              rotas
apps/web/server/api/orgs/[orgId]/partner-creators/**     rotas
apps/web/server/api/orgs/[orgId]/budget.get.ts
apps/web/app/pages/orgs/[orgId]/sources/index.vue        lista + "Novo corte"
apps/web/app/pages/orgs/[orgId]/sources/[sourceId].vue   status, direitos, candidatos
apps/web/app/components/RightsForm.vue, CandidateCard.vue, ChunkedUpload.ts (composable)
docs: ADR 0008/0010 (estado), 05, 07/youtube.md (yt-dlp), 09, 21, runbooks/storage-cors.md
```

---

### Task 1: Modelo de dados do cortador

**Files:**
- Modify: `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`
- Create: `packages/db/prisma/migrations/20261118150000_cutter/migration.sql` (gerada com `prisma migrate dev --create-only`, revisada à mão)
- Test: `packages/db/test/cutter-schema.test.ts`

**Interfaces:**
- Produces (enums, exportados de `@central/db`):
  - `RightsBasis = own | authorized | cc_license | clipper_program | none`
  - `SourceKind = upload | youtube_link`
  - `SourceStatus = awaiting_upload | queued | downloading | probing | transcribing | analyzing | ready | failed | blocked_budget`
  - `CandidateStatus = suggested | accepted | rejected | rendered`
  - `ReframeLayout = face | center | game_facecam | blur_fit`
  - `MediaAssetKind = original` (só esse valor por enquanto; a Fase 4 acrescenta `rendition`)
  - `AiRunStatus = ok | invalid_output | refused | error`
  - `CostCategory = llm | transcription`
- Produces (modelos; todos com `id uuid(7)`, `createdAt`/`updatedAt` Timestamptz(3) como os existentes, salvo indicação; tabelas mapeadas com `@@map` em snake_case com prefixo `_` igual a `_organizations`/`_social_accounts` — siga o padrão da migração de 20261117130000):
  - `PartnerCreator`: `organizationId`, `name`, `channels String[]`, `authorizationUrl String?`, `authorizationKey String?` (chave no storage), `notes String @default("")`. `@@index([organizationId])`. `onDelete: Cascade` da organização.
  - `Source`: `organizationId`, `kind`, `title String`, `originalUrl String?`, `status SourceStatus @default(awaiting_upload)`, `statusDetail String?` (mensagem pt-BR para a UI), `attempts Int @default(0)`, `rightsBasis RightsBasis` (cópia da declaração vigente), `partnerCreatorId String?` (SetNull), `params Json` (`{targetMin,targetMax,minSec,maxSec,language}`), `uploadKey String?`, `uploadId String?`, `uploadSizeBytes BigInt?`, `mediaAssetId String? @unique`, `signals Json?`, `createdById String?` (SetNull). `@@index([organizationId, createdAt])`.
  - `RightsDeclaration`: `sourceId` (Cascade), `basis`, `creatorName String?`, `evidenceUrl String?`, `evidenceKey String?`, `licenseType String?`, `sourceUrl String?`, `programUrl String?`, `partnerCreatorId String?`, `declaredById String?`, `declaredAt Timestamptz default now()`. Sem `updatedAt` (imutável). `@@index([sourceId, declaredAt])`.
  - `MediaAsset`: `organizationId`, `kind`, `storageKey String @unique`, `sha256 String`, `sizeBytes BigInt`, `mimeType String`, `probe Json`, `durationMs Int`, `width Int?`, `height Int?`, `hasAudio Boolean`. `@@index([organizationId, sha256])`.
  - `Transcript`: `sourceId String @id` (Cascade), `language String`, `text String`, `words Json` (`[{w,s,e}]` em ms), `provider`, `model`, `durationSec Int`, `costUsd Decimal(12,6)`, `createdAt`.
  - `AiRun`: `organizationId`, `sourceId String?` (SetNull), `task String`, `provider`, `model`, `promptId`, `promptVersion Int`, `inputHash String`, `output Json?`, `status AiRunStatus`, `error String?`, `inputTokens Int @default(0)`, `outputTokens Int @default(0)`, `cacheReadTokens Int @default(0)`, `cacheWriteTokens Int @default(0)`, `costUsd Decimal(12,6) @default(0)`, `latencyMs Int`, `createdAt`. `@@index([task, inputHash, promptVersion, model])`.
  - `CostLedger`: `organizationId`, `category CostCategory`, `provider`, `units Decimal(14,4)`, `unitType String`, `costUsd Decimal(12,6)`, `refType String`, `refId String`, `occurredAt Timestamptz default now()`. `@@unique([refType, refId, unitType])` (impede lançamento duplicado em retry) e `@@index([organizationId, occurredAt])`.
  - `ClipCandidate`: `organizationId`, `sourceId` (Cascade), `aiRunId String?`, `rank Int`, `startMs Int`, `endMs Int`, `suggestedStartMs Int`, `suggestedEndMs Int`, `hookScore Int`, `reason String`, `title String`, `captions Json`, `hashtags String[]`, `layout ReframeLayout`, `status CandidateStatus @default(suggested)`, `decidedById String?`, `decidedAt DateTime?`. `@@index([sourceId, rank])`. Na migração, acrescente à mão `CHECK ("hookScore" BETWEEN 0 AND 100)` e `CHECK ("endMs" > "startMs")`.
  - Relações inversas em `Organization` (`sources`, `partnerCreators`) e `exports` dos tipos novos em `packages/db/src/index.ts`, do mesmo jeito que os da Fase 2.

- [ ] **Step 1: Escrever o teste que falha** em `packages/db/test/cutter-schema.test.ts`, com `startTestDatabase()`:
  - `cria fonte com declaração, asset, transcrição e candidato encadeados` — cria org → source → rightsDeclaration → mediaAsset (liga `mediaAssetId`) → transcript → clipCandidate; `findUnique` do source com `include` devolve tudo.
  - `CostLedger recusa lançamento duplicado` — dois `create` com o mesmo `(refType, refId, unitType)`: o segundo rejeita com código `P2002`.
  - `ClipCandidate recusa hookScore fora de 0..100 e fim <= início` — `hookScore: 101` rejeita; `startMs: 5000, endMs: 5000` rejeita.
  - `apagar a organização apaga fontes, candidatos e criadores parceiros` — `organization.delete` → contagens 0.
- [ ] **Step 2: Rodar e ver falhar:** `pnpm --filter @central/db exec vitest run test/cutter-schema.test.ts` → FAIL (modelos inexistentes).
- [ ] **Step 3: Escrever schema e migração**, depois `pnpm --filter @central/db generate`.
- [ ] **Step 4: Rodar:** o mesmo comando → PASS; `pnpm --filter @central/db test` → todos PASS (inclusive `migration-rename.test.ts`).
- [ ] **Step 5: Commit:** `feat(db): modelo do cortador (fontes, direitos, mídia, transcrição, IA, custos, candidatos)`

---

### Task 2: Storage — multipart, URLs pré-assinadas e arquivos

**Files:**
- Modify: `packages/storage/src/s3.ts`, `packages/storage/package.json` (+ `@aws-sdk/s3-request-presigner` 3.1169.0)
- Test: `packages/storage/test/s3.test.ts` (acrescentar)

**Interfaces:**
- Produces (métodos novos em `Storage`):
  - `createMultipart(key: string, contentType: string): Promise<{ uploadId: string }>`
  - `presignPart(key: string, uploadId: string, partNumber: number, expiresSec?: number): Promise<string>` (padrão 3600)
  - `completeMultipart(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void>`
  - `abortMultipart(key: string, uploadId: string): Promise<void>` (não falha se já não existir)
  - `presignPut(key: string, contentType: string, expiresSec?: number): Promise<string>` (anexos pequenos; a URL de PUT não impõe tamanho, então quem chama confere com `head` depois)
  - `presignGet(key: string, opts?: { expiresSec?: number; inline?: boolean; filename?: string }): Promise<string>`
  - `head(key: string): Promise<{ sizeBytes: number; contentType?: string } | null>` (null em 404)
  - `downloadToFile(key: string, path: string): Promise<void>` (stream, sem carregar na memória)
  - `uploadFile(key: string, path: string, contentType: string): Promise<void>` (usa `@aws-sdk/lib-storage` `Upload`, partes de 64 MiB; adicionar a dependência na mesma versão do client)
  - `delete(key: string): Promise<void>`
  - Constante exportada `MULTIPART_PART_BYTES = 64 * 1024 * 1024`.

- [ ] **Step 1: Escrever os testes que falham** (MinIO já sobe no arquivo):
  - `multipart: cria, envia 2 partes por URL pré-assinada e completa` — partes de 5 MiB (mínimo do S3 para partes não finais) e 1 KiB, enviadas com `fetch(url, { method: 'PUT', body })`; `etag` do header da resposta; `completeMultipart`; `head(key).sizeBytes === 5*1024*1024 + 1024`.
  - `abortMultipart duas vezes não lança`.
  - `presignGet inline devolve o conteúdo e Content-Disposition inline` — `fetch` → corpo igual; header contém `inline`.
  - `head devolve null para chave inexistente`.
  - `uploadFile e downloadToFile fazem ida e volta com o mesmo sha256` (arquivo temporário de 1 MiB aleatório).
  - `delete remove o objeto` → `head` null.
- [ ] **Step 2: Rodar e ver falhar:** `pnpm --filter @central/storage test` → FAIL.
- [ ] **Step 3: Implementar** em `s3.ts`. `presignGet` com `ResponseContentDisposition` `inline` ou `attachment; filename="…"`.
- [ ] **Step 4: Rodar:** `pnpm --filter @central/storage test` → PASS.
- [ ] **Step 5: Commit:** `feat(storage): upload multipart pré-assinado, URLs de leitura e transferência de arquivos`

---

### Task 3: Pacote `@central/media` — ffprobe, áudio, sinais, quadros e hash

**Files:**
- Create: `packages/media/{package.json,tsconfig.json,vitest.config.ts}` (copie a forma de `packages/storage`; `exports` com `.` → `src/index.ts` e `./testing` → `src/testing.ts`), `src/{index,bin,run,probe,audio,signals,frames,hash,testing}.ts`, `test/media.test.ts`
- Modify: `pnpm-workspace.yaml` (`onlyBuiltDependencies: [ffmpeg-static]`, porque o pnpm 10 bloqueia o postinstall que baixa o binário), `.github/workflows/ci.yml` (incluir `@central/media` e `@central/ai` no passo "Testes (shared, db, storage, worker)")

**Interfaces:**
- Produces:
  - `ffmpegPath(): string`, `ffprobePath(): string` — `process.env.FFMPEG_PATH ?? ffmpeg-static`; idem para ffprobe com `ffprobe-static`.path.
  - `runTool(bin: string, args: string[], opts: { timeoutMs: number; cwd?: string; signal?: AbortSignal }): Promise<{ stdout: string; stderr: string }>` — `spawn` sem shell; mata o processo no timeout e rejeita com `MediaToolError` (`code: 'TIMEOUT' | 'EXIT'`, `stderrTail` com as últimas 20 linhas).
  - `export class MediaToolError extends Error { code; stderrTail }`
  - `probe(path: string): Promise<MediaProbe>` com `MediaProbe = { container: string; durationMs: number; sizeBytes: number; bitrate: number | null; video: { codec: string; width: number; height: number; fps: number; isVfr: boolean } | null; audio: { codec: string; sampleRate: number; channels: number } | null; tags: Record<string,string> }` (largura/altura **depois da rotação**, docs/10 §3). Timeout 60 s.
  - `extractAudioChunks(input: string, outDir: string, chunkSec = 600): Promise<Array<{ path: string; offsetMs: number }>>` — ogg/opus 16 kHz mono 32 kbps, um arquivo por bloco (`-f segment -segment_time`), offsets em ordem.
  - `analyzeSignals(input: string, durationMs: number): Promise<Signals>` com `Signals = { loudPeaksSec: number[]; sceneCutsSec: number[]; motion: Array<{ startSec: number; score: number }> }` (valores de R10; `loudPeaksSec` vazio se não houver áudio; `motion` só as 20 janelas de maior score, ordenadas por `startSec`).
  - `frameTimes(durationMs: number): number[]` — segundos dos quadros: a cada `max(10, duração/40)` s a partir de 0, teto 40 (R10).
  - `sampleFrames(input: string, durationMs: number, outDir: string): Promise<Array<{ path: string; atSec: number }>>` — um JPEG de 768 px no maior lado por tempo de `frameTimes`.
  - `sha256File(path: string): Promise<string>` (hex).
  - Timeout das operações longas: `10 × duração + 120 s` (docs/10 §10), via helper `longTimeoutMs(durationMs)`.

- [ ] **Step 1: Fixtures** em `src/testing.ts` (exportado como `@central/media/testing`, usado também pelo worker e pelo E2E): `makeVideo(dir, opts: { seconds: number; audio: 'none' | 'tone' | 'burst'; sceneCutAtSec?: number; rotate90?: boolean }): Promise<string>` usando o próprio `ffmpegPath()` com `testsrc2`/`color` + `sine`; `burst` = seno a −40 dBFS com 1 s a −6 dBFS no segundo 4; `sceneCutAtSec` concatena duas cores diferentes; `rotate90` grava metadado de rotação.
- [ ] **Step 2: Escrever os testes que falham** em `test/media.test.ts` (um diretório temporário por arquivo):
  - `probe lê duração, resolução e áudio` — vídeo 8 s 640×360 com tom → `durationMs` entre 7900 e 8100, `video.width 640`, `audio !== null`.
  - `probe aplica rotação` — `rotate90` → `width 360`, `height 640`.
  - `probe de vídeo sem áudio devolve audio null`.
  - `probe de arquivo truncado rejeita com MediaToolError` (corte os bytes do fim).
  - `extractAudioChunks com chunkSec 3 em vídeo de 8 s gera 3 blocos com offsets 0, 3000, 6000`.
  - `analyzeSignals encontra o pico no segundo 4 e o corte de cena no segundo 5` — `loudPeaksSec` contém 4; `sceneCutsSec` tem um valor entre 4.5 e 5.5.
  - `analyzeSignals sem áudio devolve loudPeaksSec vazio`.
  - `sampleFrames respeita intervalo mínimo de 10 s e teto de 40` — vídeo de 25 s → 3 quadros em 0, 10, 20; `frameTimes(3 * 3_600_000)` → 40 tempos.
  - `runTool mata o processo no timeout` — `ffmpeg` lendo `testsrc` infinito com `timeoutMs: 500` → `code 'TIMEOUT'`.
  - `sha256File bate com createHash do conteúdo`.
- [ ] **Step 3: Rodar e ver falhar:** `pnpm install && pnpm --filter @central/media test` → FAIL.
- [ ] **Step 4: Implementar.** Sinais em **uma** passada de vídeo (`fps=2,scale=320:-2,select='gte(scene,0)',metadata=print:file=-`) e **uma** de áudio (`aresample=16000,asetnsamples=16000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`), com parse da saída de texto.
- [ ] **Step 5: Rodar:** `pnpm --filter @central/media test` e `pnpm --filter @central/media typecheck` → PASS.
- [ ] **Step 6: Commit:** `feat(media): ffprobe normalizado, blocos de áudio, sinais técnicos, quadros e sha256`

---

### Task 4: Pacote `@central/ai` — transcrição Groq e custos

**Files:**
- Create: `packages/ai/{package.json,tsconfig.json,vitest.config.ts}`, `src/{index,transcriber,pricing}.ts`, `test/transcriber.test.ts`, `test/pricing.test.ts`

**Interfaces:**
- Produces:
  - `interface Transcriber { readonly provider: string; readonly model: string; transcribe(chunks: Array<{ path: string; offsetMs: number }>, language: string): Promise<TranscriptResult> }`
  - `TranscriptResult = { language: string; text: string; words: Array<{ w: string; s: number; e: number }>; durationSec: number }` (ms absolutos, já somado o `offsetMs` de cada bloco).
  - `createGroqTranscriber(opts: { apiKey: string; baseUrl?: string; fetch?: typeof fetch; maxRetries?: number }): Transcriber` — `POST {baseUrl ?? 'https://api.groq.com/openai/v1'}/audio/transcriptions`, multipart com `file`, `model=whisper-large-v3-turbo`, `language` (só o código ISO-639-1: `pt-BR` → `pt`), `response_format=verbose_json`, `timestamp_granularities[]=word`. ❓ a página da Groq é inconsistente sobre `verbose_json` vs `json` para `timestamp_granularities`: comente isso no código e trate a ausência de `words` na resposta como erro `TranscriberError('NO_WORD_TIMESTAMPS')`. `baseUrl` sobrescrito só quando `NODE_ENV === 'test'` (mesma regra da Fase 2). Retry em 429/5xx/erro de rede com backoff (respeita `retry-after`), padrão 3 tentativas; 4xx restantes falham sem retry. O header `Authorization` nunca entra em mensagens de erro.
  - `export class TranscriberError extends Error { code: 'HTTP' | 'NO_WORD_TIMESTAMPS' | 'NETWORK'; status?: number; retryable: boolean }`
  - `PRICES` (US$, de docs/09 e docs/04, com comentário "referência 2026, confirmar na página oficial"): `{ 'claude-opus-5-5': { inPerMTok: 4, outPerMTok: 20, cacheReadPerMTok: 0.4, cacheWritePerMTok: 5 }, 'whisper-large-v3-turbo': { perHour: 0.04, minBilledSec: 10 } }`
  - `llmCostUsd(model: string, usage: { inputTokens; outputTokens; cacheReadTokens; cacheWriteTokens }): number`
  - `transcriptionCostUsd(chunkDurationsSec: number[]): number` — cada bloco cobrado com mínimo de 10 s.
  - `estimateAnalysisCostUsd(durationMs: number, frameCount: number): number` = transcrição da duração inteira + Claude com entrada `ceil(min × 200) + frameCount × 450 + 3000` tokens e saída 4000 tokens (constantes nomeadas e exportadas).

- [ ] **Step 1: Escrever os testes que falham** (`fetch` falso injetado, sem rede):
  - `transcribe envia modelo, idioma pt e granularidade word` — inspeciona o `FormData` recebido.
  - `transcribe soma offsets dos blocos` — dois blocos (offset 0 e 600000), respostas com palavras em 1.0 s → `words[1].s === 601000`.
  - `transcribe repete em 429 e 503 e desiste depois de maxRetries` — 2 falhas + sucesso → ok; 4 falhas com `maxRetries 3` → `TranscriberError` com `retryable: true`.
  - `transcribe não repete em 400` e a mensagem não contém a chave da API.
  - `resposta sem words rejeita com NO_WORD_TIMESTAMPS`.
  - `transcriptionCostUsd([3600]) === 0.04` e `([5]) ≈ 0.04 × 10 / 3600`.
  - `llmCostUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 0, … }) === 4`; modelo desconhecido lança.
  - `estimateAnalysisCostUsd(3_600_000, 40)` igual ao valor calculado à mão no teste a partir das constantes exportadas.
- [ ] **Step 2: Rodar e ver falhar:** `pnpm --filter @central/ai test` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar:** `pnpm --filter @central/ai test` → PASS.
- [ ] **Step 5: Commit:** `feat(ai): transcrição Groq com timestamps por palavra e cálculo de custos`

---

### Task 5: `@central/ai` — `LlmProvider` Anthropic

**Files:**
- Create: `packages/ai/src/llm.ts`, `packages/ai/test/llm.test.ts`
- Modify: `packages/ai/package.json` (+ `@anthropic-ai/sdk` 1.10.0)

Antes de implementar, consulte a skill `claude-api` (ou a documentação oficial do SDK) para a forma atual de saída estruturada (`output_config.format` com JSON Schema, docs/09 §4), imagens em base64 e `stop_reason`. Não invente parâmetros.

**Interfaces:**
- Produces:
  - `interface LlmProvider { readonly provider: string; generateStructured(req: StructuredRequest): Promise<StructuredResult> }`
  - `StructuredRequest = { model: string; system: string; cachedContext: string; userText: string; images: Array<{ mediaType: 'image/jpeg'; base64: string }>; jsonSchema: object; maxTokens: number; effort?: 'low' | 'medium' }` — `system` + `cachedContext` (instruções, regras de rede, guia de voz) vão primeiro com `cache_control`; transcrição, sinais e quadros vão depois (docs/09 §4).
  - `StructuredResult = { status: 'ok' | 'refused'; json: unknown; usage: { inputTokens; outputTokens; cacheReadTokens; cacheWriteTokens }; latencyMs: number; model: string }`
  - `createAnthropicProvider(opts: { apiKey: string; client?: AnthropicLike }): LlmProvider` — `client` injetável para teste (`AnthropicLike` = o subconjunto `messages.create` usado).
  - `export class LlmError extends Error { retryable: boolean }` — 429/5xx/overloaded/rede são `retryable`; 4xx restantes não.

- [ ] **Step 1: Escrever os testes que falham** com um `client` falso:
  - `generateStructured monta system com cache_control, imagens em base64 e o schema na requisição` — inspeciona o objeto passado ao `messages.create`.
  - `devolve json parseado e usage com tokens de cache`.
  - `stop_reason refusal vira status refused sem lançar`.
  - `erro 529/overloaded vira LlmError retryable; 400 vira não retryable`.
  - `a mensagem do LlmError não contém a apiKey`.
- [ ] **Step 2: Rodar e ver falhar:** `pnpm --filter @central/ai exec vitest run test/llm.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar:** → PASS.
- [ ] **Step 5: Commit:** `feat(ai): provedor Anthropic com saída estruturada, cache de prompt e recusas`

---

### Task 6: `@central/ai` — tarefa `select_clips`

**Files:**
- Create: `packages/ai/prompts/select-clips/v1.md`, `packages/ai/src/select-clips.ts`, `packages/ai/test/select-clips.test.ts`

**Interfaces:**
- Consumes: `LlmProvider` (Task 5), `llmCostUsd` (Task 4).
- Produces:
  - `SELECT_CLIPS_PROMPT = { id: 'select-clips', version: 1 }`
  - `CandidateOut = { startSec: number; endSec: number; hookScore: number; reason: string; title: string; layout: 'face' | 'center' | 'game_facecam' | 'blur_fit'; hashtags: string[]; captions: { instagram: { caption: string }; facebook: { caption: string }; tiktok: { caption: string }; youtube: { title: string; description: string } } }` com schema zod `candidateOutSchema` (limites: `reason` ≤ 200, `title` ≤ 100, `hashtags` ≤ 8 itens sem `#` duplicado; Instagram `caption` ≤ 2200 e ≤ 30 hashtags no total; TikTok ≤ 2200; YouTube `title` ≤ 100 e `description` ≤ 5000; Facebook ≤ 2200 ❓ — docs/07/facebook.md não informa limite, 2200 é teto nosso) e `z.toJSONSchema` para o `jsonSchema`.
  - `SelectClipsInput = { durationMs: number; language: string; params: { targetMin: number; targetMax: number; minSec: number; maxSec: number }; org: { name: string; tags: string[]; voiceGuide: string }; transcript: { text: string; words: Array<{ w; s; e }> }; signals: Signals; frames: Array<{ atSec: number; base64: string }> }`
  - `selectClips(llm: LlmProvider, input: SelectClipsInput, opts: { model: string; maxAttempts?: number }): Promise<SelectClipsResult>` com `SelectClipsResult = { candidates: CandidateOut[]; runs: Array<{ status: 'ok' | 'invalid_output' | 'refused' | 'error'; usage; costUsd: number; latencyMs: number; error?: string; output?: unknown }>; inputHash: string }`
  - `selectClipsInputHash(input: SelectClipsInput, model: string): string` — sha256 do JSON canônico (chaves ordenadas) de `input` (quadros por sha256 do base64, não o base64 inteiro) + `model` + versão do prompt.
  - `postValidate(cands: CandidateOut[], input: SelectClipsInput): CandidateOut[]` (exportada para teste).

  Regras de `postValidate`, nesta ordem: descarta `startSec < 0`, `endSec > durationMs/1000`, duração fora de `[minSec, maxSec]`; arredonda para décimos; ordena por `hookScore` desc; descarta quem sobrepõe **mais de 50%** da duração do menor com um já mantido; corta em `targetMax`.

  Comportamento de `selectClips`: até `maxAttempts` (padrão **3**) chamadas; uma tentativa conta como falha quando o JSON não passa no zod, quando sobram **0** candidatos depois de `postValidate`, ou quando `LlmError.retryable`. `LlmError` não retryable e `refused` encerram na hora. Toda tentativa, ok ou não, entra em `runs` com o custo. Se terminar sem candidatos, devolve `candidates: []` (quem chama decide o `failed`).

  O prompt `v1.md` (pt-BR) diz: escolher trechos com gancho nos 2 primeiros segundos e fim natural; usar só o que está na entrada (docs/09 §5); vídeo sem fala → apoiar-se em sinais e quadros; textos no idioma pedido e no guia de voz; sugerir `game_facecam` quando os quadros mostram jogo com câmera do jogador, `face` com pessoa em cena, `blur_fit` quando o enquadramento horizontal importa, `center` no resto. A transcrição vai ao modelo como linhas `[mm:ss] texto` agrupadas a cada ~10 s.

- [ ] **Step 1: Escrever os testes que falham** (LLM falso que devolve respostas programadas):
  - `postValidate descarta fora da duração, fora da faixa e sobreposto, e corta em targetMax` — entrada com 6 candidatos construídos para cada regra → sobram os esperados, na ordem por nota.
  - `selectClips repete quando o JSON é inválido e aceita a segunda resposta` — `runs` = `['invalid_output', 'ok']`, ambos com `costUsd > 0`.
  - `selectClips com 3 respostas sem candidato válido devolve [] e 3 runs`.
  - `selectClips com recusa para na primeira tentativa` → `runs[0].status === 'refused'`, `candidates: []`.
  - `transcrição vazia não quebra e o texto do usuário diz que não há fala` — inspeciona `userText`.
  - `inputHash é estável para a mesma entrada e muda com a versão do prompt ou o modelo`.
  - `o jsonSchema enviado exige os campos do candidato` — `required` contém `startSec`, `hookScore`, `layout`, `captions`.
- [ ] **Step 2: Rodar e ver falhar:** `pnpm --filter @central/ai exec vitest run test/select-clips.test.ts` → FAIL.
- [ ] **Step 3: Implementar** e escrever `v1.md`.
- [ ] **Step 4: Rodar:** `pnpm --filter @central/ai test` → PASS.
- [ ] **Step 5: Commit:** `feat(ai): tarefa select_clips com prompt v1, schema e pós-validação`

---

### Task 7: Core — direitos, criadores parceiros, fontes e orçamento

**Files:**
- Create: `packages/core/src/cutter/{rights,partner-creator-service,source-service,budget}.ts`, `packages/core/test/cutter/{rights,partner-creator-service,source-service,budget}.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json` (+ `@central/storage`), `packages/shared/src/queue.ts` (`QUEUES.sourceAnalyze = 'source.analyze'`, `QUEUES.sourceDownload = 'source.download'`), `packages/db/src/queue/pgboss-queue.ts` (as duas com política `exclusive`)

**Interfaces:**
- Consumes: `requireOrgAccess`, `writeAudit`, erros de domínio (Fase 2); `Storage` (Task 2); `JobQueue`/`sqlExecutorFor`.
- Produces:
  - `rights.ts`:
    - `RightsInput = { basis: RightsBasis; accepted?: boolean; creatorName?: string; evidenceUrl?: string; evidenceKey?: string; licenseType?: string; sourceUrl?: string; programUrl?: string; partnerCreatorId?: string }`
    - `validateRights(input: RightsInput, partner?: { name: string; authorizationUrl: string | null; authorizationKey: string | null }): RightsInput` — lança `ValidationError` com mensagem pt-BR por regra: `own` exige `accepted === true`; `authorized` exige `creatorName` e (`evidenceUrl` ou `evidenceKey`), ou um parceiro com autorização (aí herda nome e evidência); `cc_license` exige `sourceUrl` e `licenseType`; `clipper_program` exige `programUrl`; `none` não exige nada. URLs só `https:`. Função pura; quem chama confere, com `storage.head`, que um `evidenceKey` começa com `orgs/<orgId>/evidence/`, existe e tem até 10 MiB.
    - `assertPublishable(db: DbOrTx, sourceId: string): Promise<void>` — lança `ForbiddenError('Fonte sem direitos de publicação.')` se `rightsBasis === 'none'`. As Fases 4 e 5 chamam isto em publicar, agendar e baixar.
  - `PartnerCreatorService`: `list(actor, orgId)`, `create(actor, orgId, input: { name; channels: string[]; authorizationUrl?; authorizationKey?; notes? })`, `update(actor, orgId, id, patch)`, `remove(actor, orgId, id)` — ação `settings.manage`; `authorizationKey` vem de `presignEvidenceUpload` e é conferido com `storage.head` (prefixo da organização, até 10 MiB) no `create`/`update`.
  - `SourceService`:
    - `createUpload(actor, orgId, input: { title: string; fileName: string; sizeBytes: number; contentType: string; rights: RightsInput; params?: Partial<SourceParams> }): Promise<{ source: SourceView; uploadId: string; partSize: number; partCount: number }>` — `content.edit`; `sizeBytes` ≤ 4 GiB (`4 * 1024 ** 3`) senão `ValidationError('Arquivo acima de 4 GB.')`; `contentType` em `video/mp4`, `video/quicktime`, `video/webm`, `video/x-matroska`; chave `orgs/<orgId>/sources/<sourceId>/original<ext>`; grava `Source` + `RightsDeclaration` + auditoria `source.create` (com a declaração no `diff`) numa transação; `params` = `clipDefaults` da organização + `language` = `locale`, sobrescritos pelo que vier.
    - `presignEvidenceUpload(actor, orgId, contentType: string): Promise<{ key: string; url: string }>` — `content.edit`; chave `orgs/<orgId>/evidence/<uuid>`; tipos `image/png`, `image/jpeg`, `application/pdf` (outro → `ValidationError`). Serve à evidência da declaração e à autorização do parceiro.
    - `presignParts(actor, orgId, sourceId, partNumbers: number[]): Promise<Array<{ partNumber; url }>>` — só em `awaiting_upload`; até 100 números por chamada, cada um em `1..partCount`.
    - `completeUpload(actor, orgId, sourceId, parts: Array<{ partNumber; etag }>): Promise<SourceView>` — idempotente (fonte já fora de `awaiting_upload` → devolve a view sem mexer); confere `head` (tamanho ≤ 4 GiB e igual ao declarado, senão `abortMultipart`/`delete`, `failed` e `ValidationError`); muda para `queued` e envia `source.analyze` `{ sourceId }` com `singletonKey: sourceId` **na mesma transação** (`sqlExecutorFor`).
    - `abandonUpload(actor, orgId, sourceId): Promise<void>` — aborta o multipart e apaga a fonte em `awaiting_upload`.
    - `createFromLink(actor, orgId, input: { title; url: string; rights: RightsInput; params? }, opts: { linkEnabled: boolean }): Promise<SourceView>` — `linkEnabled` falso → `ValidationError('Envio por link desativado. Envie o arquivo MP4.')`; `rights.basis === 'none'` → `ValidationError('Link sem direitos não é baixado. Declare os direitos ou envie o arquivo.')` **antes** de criar qualquer coisa; URL só `https://(www.|m.)?youtube.com/watch?v=` ou `https://youtu.be/`; cria em `queued` (kind `youtube_link`) e envia `source.download` na transação.
    - `list(actor, orgId): Promise<SourceView[]>` (`library.read`, mais recentes primeiro, com contagem de candidatos por status) e `get(actor, orgId, sourceId): Promise<SourceDetail>` (inclui histórico de declarações e o asset).
    - `changeRights(actor, orgId, sourceId, rights: RightsInput): Promise<SourceDetail>` — `publication.approve`; nova `RightsDeclaration`, atualiza `rightsBasis`, auditoria `source.rights_change` com `{ from, to }`. (Bloquear agendamentos ao ir para `none` entra na Fase 5, que é quando eles existem: deixe um comentário `// Fase 5:` no ponto.)
    - `retry(actor, orgId, sourceId): Promise<SourceView>` — `content.edit`; só de `failed` ou `blocked_budget`; zera `attempts`, volta a `queued` (ou ao job de download se não há asset) e reenvia o job.
  - `SourceView = { id; title; kind; status; statusDetail; rightsBasis; createdAt; candidateCounts: Record<CandidateStatus, number> }`; `SourceDetail = SourceView & { originalUrl; params; durationMs: number | null; rightsHistory: Array<{ basis; creatorName; evidenceUrl; licenseType; sourceUrl; programUrl; declaredBy: string | null; declaredAt }> }`.
  - `budget.ts`:
    - `monthSpendUsd(db, orgId, now = new Date()): Promise<number>` — soma `CostLedger.costUsd` do mês-calendário UTC (R3).
    - `checkBudget(db, orgId, estimateUsd, now?): Promise<{ allowed: boolean; spentUsd: number; budgetUsd: number }>` — `allowed = spent + estimate <= budget`.
    - `recordCost(db, entry: { organizationId; category; provider; units; unitType; costUsd; refType; refId }): Promise<void>` — `create` que ignora `P2002` (retry), e depois, se o gasto do mês cruzou **80%** e ainda não há auditoria `budget.alert` neste mês para a organização, grava `budget.alert` com `{ spentUsd, budgetUsd }` e loga `warn`.
    - `budgetStatus(actor, orgId): Promise<{ spentUsd; budgetUsd; alert: boolean; blocked: boolean }>` (`library.read`) para o aviso no painel.

- [ ] **Step 1: Escrever os testes que falham** (Postgres + MinIO via Testcontainers; fila real com `createPgBossQueue({ role: 'worker' })` para conferir jobs enviados):
  - `rights.test.ts`: um caso por regra de `validateRights` (válido e inválido), parceiro com autorização satisfaz `authorized`, URL `http:` recusada; `assertPublishable` lança para `none` e passa para `own`.
  - `source-service.test.ts`:
    - `createUpload cria fonte, declaração e auditoria; params vêm da organização`.
    - `createUpload recusa 4 GiB + 1 byte e content-type de imagem`.
    - `upload completo por URLs pré-assinadas vai para queued e envia source.analyze` (2 partes de 5 MiB via `fetch`).
    - `completeUpload duas vezes é idempotente e envia um só job`.
    - `completeUpload com tamanho diferente do declarado aborta, marca failed e lança ValidationError` (Review Focus 1).
    - `createFromLink com none lança antes de criar fonte ou job` (contagens 0).
    - `createFromLink desativado lança e URL fora do YouTube lança`.
    - `changeRights por editor é ForbiddenError; por aprovador grava nova declaração e preserva a anterior`.
    - `retry só a partir de failed ou blocked_budget`.
    - `outra organização: get e changeRights lançam NotFoundError`.
  - `partner-creator-service.test.ts`: CRUD por admin; editor recebe `ForbiddenError`; anexo acima de 10 MiB ou com chave de outra organização recusado.
  - `source-service.test.ts` (mais): `presignEvidenceUpload recusa text/html`; `declaração authorized com evidenceKey inexistente lança ValidationError`.
  - `budget.test.ts`: `monthSpendUsd` ignora o mês anterior; `checkBudget` bloqueia quando `spent + estimate > budget`; `recordCost` repetido não duplica; cruzar 80% grava **um** `budget.alert` mesmo com dois lançamentos seguidos.
- [ ] **Step 2: Rodar e ver falhar:** `pnpm --filter @central/core exec vitest run test/cutter` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar:** `pnpm --filter @central/core test:coverage` → PASS e cobertura ≥ 80%.
- [ ] **Step 5: Commit:** `feat(core): fontes com trava de direitos, criadores parceiros, upload multipart e orçamento de IA`

---

### Task 8: Core — candidatos

**Files:**
- Create: `packages/core/src/cutter/candidate-service.ts`, `packages/core/test/cutter/candidate-service.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `CandidateView = { id; rank; startMs; endMs; suggestedStartMs; suggestedEndMs; hookScore; reason; title; captions; hashtags; layout; status; decidedAt }`
  - `CandidateService`:
    - `list(actor, orgId, sourceId): Promise<CandidateView[]>` — `library.read`, ordem por `rank`.
    - `decide(actor, orgId, candidateId, decision: 'accept' | 'reject'): Promise<CandidateView>` — `content.edit`; só de `suggested`, `accepted` ou `rejected` (dá para mudar de ideia antes de renderizar); `rendered` → `ConflictError`. Grava `decidedById`/`decidedAt` e auditoria `candidate.accept`/`candidate.reject`. (Disparar a renderização é a Fase 4: deixe `// Fase 4:` no ponto.)
    - `adjust(actor, orgId, candidateId, input: { startMs: number; endMs: number; layout?: ReframeLayout; title?: string }): Promise<CandidateView>` — `content.edit`; `0 ≤ startMs < endMs ≤ durationMs` do asset; duração entre **3 s e 180 s** (3 s é o mínimo do Facebook Reels, spec §3; 180 s é o teto dos Shorts) senão `ValidationError`; não chama IA; só fora de `rendered`; auditoria `candidate.adjust` com antes e depois.
    - `playerUrl(actor, orgId, sourceId): Promise<{ url: string; expiresAt: Date }>` — `library.read`; `storage.presignGet(key, { inline: true, expiresSec: 3600 })` do original (R8).
  - `ReframeLayout` reexportado de `@central/db`.

- [ ] **Step 1: Escrever os testes que falham:**
  - `list devolve na ordem de rank e só da fonte pedida`.
  - `accept e depois reject mudam o status e auditam; rendered recusa com ConflictError`.
  - `viewer não decide (ForbiddenError)`.
  - `adjust valida limites: fim além da duração, 2 s e 181 s recusados; 3 s aceito`.
  - `adjust preserva suggestedStartMs/suggestedEndMs`.
  - `candidato de outra organização: decide, adjust e list lançam NotFoundError` (Review Focus 5).
  - `playerUrl devolve URL que responde 200 com Content-Disposition inline`.
- [ ] **Step 2: Rodar e ver falhar:** `pnpm --filter @central/core exec vitest run test/cutter/candidate-service.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar:** `pnpm --filter @central/core test:coverage` → PASS.
- [ ] **Step 5: Commit:** `feat(core): candidatos — aceitar, rejeitar, ajustar início e fim e URL do player`

---

### Task 9: Worker — pipeline `source.analyze`

**Files:**
- Create: `apps/worker/src/config.ts`, `apps/worker/src/scratch.ts`, `apps/worker/src/handlers/source-analyze.ts`, `apps/worker/test/source-analyze.test.ts`
- Modify: `apps/worker/src/worker.ts` (registra o handler com `concurrency: 1`), `apps/worker/src/main.ts` (config nova), `apps/worker/package.json` (+ `@central/media`, `@central/ai`, `@central/storage`), `docker/worker.Dockerfile` (copia os `package.json` dos pacotes novos; `SCRATCH_DIR=/scratch` gravável pelo usuário `node`), `compose.yaml`, `compose.prod.yaml` (volume `scratch`, variáveis novas como chaves sem valor), `.env.example`

**Interfaces:**
- Consumes: Tasks 2 a 7.
- Produces:
  - `workerEnvSchema` = `baseEnvSchema` + `storageEnvSchema` + `ANTHROPIC_API_KEY` e `GROQ_API_KEY` (opcionais com `emptyAsUnset`; sem elas a análise falha com `statusDetail` "Integração de IA não configurada." e não lança), `AI_MODEL` (padrão `claude-opus-5-5`), `SCRATCH_DIR` (padrão `os.tmpdir()/central-scratch`), `YTDLP_ENABLED`/`YTDLP_PATH` (usados na Task 10).
  - `withScratch<T>(root: string, jobId: string, fn: (dir: string) => Promise<T>): Promise<T>` — cria `<root>/<jobId>`, apaga em `finally`.
  - `createSourceAnalyzeHandler(deps: { db; storage: Storage; transcriber: Transcriber | null; llm: LlmProvider | null; model: string; scratchRoot: string; maxDurationMs?: number; logger }): (job: { id: string; data: { sourceId: string } }) => Promise<void>`
  - `startWorker` passa a aceitar `deps?: Partial<…>` para injetar `transcriber`/`llm`/`storage` falsos em teste.

  Etapas (cada uma grava `status` antes de começar):
  1. Carrega a fonte; se não estiver em `queued`/`probing`/`transcribing`/`analyzing` (estados retomáveis), retorna sem fazer nada.
  2. `probing`: baixa o original para o scratch; se ainda não há `MediaAsset`, calcula `sha256File` + `probe` e cria o asset; sem vídeo, ou duração > **2 h** → `failed` ("Vídeo acima de 2 h." / "Arquivo sem faixa de vídeo.").
  3. Orçamento (R4): só se ainda não existe `Transcript` nem `AiRun` ok para a fonte; `estimateAnalysisCostUsd(durationMs, frameTimes(durationMs).length)` → `checkBudget`; bloqueado → `blocked_budget` com `statusDetail` "Orçamento de IA do mês esgotado. Aumente o orçamento ou aguarde o próximo mês." e retorna.
  4. `transcribing`: se já existe `Transcript`, reaproveita. Sem áudio → `Transcript` vazio (`provider: 'none'`, custo 0), sem chamar o Groq. Com áudio → `extractAudioChunks` → `transcriber.transcribe` → `Transcript` + `recordCost` (`category: 'transcription'`, `unitType: 'seconds'`, `refType: 'Transcript'`, `refId: sourceId`).
  5. Sinais e quadros: `analyzeSignals` (grava em `Source.signals`) e `sampleFrames`.
  6. `analyzing`: monta `SelectClipsInput`; se existe `AiRun` `ok` com o mesmo `inputHash` + `promptVersion` + `model` (cache, docs/09 §4), reaproveita o `output` sem chamar a API; senão `selectClips` e grava **um `AiRun` por tentativa**, cada um com `recordCost` (`category: 'llm'`, `unitType: 'usd'`, `refType: 'AiRun'`, `refId: aiRun.id`).
  7. Candidatos: numa transação, apaga os `suggested` da fonte e cria os novos com `rank` 1..n, `suggestedStartMs = startMs`. Zero candidatos → `failed` com "A IA não encontrou trechos válidos. Tente de novo ou ajuste a faixa de duração.". Senão `ready`, `statusDetail` null.

  Falhas: `MediaToolError` de decodificação, `TranscriberError`/`LlmError` não retryable → `failed` com mensagem pt-BR e retorna. Erros retryable e de I/O → incrementa `attempts`; com `attempts >= 3` → `failed` ("Falha temporária repetida. Tente de novo."); senão relança para o pg-boss repetir. Nunca loga chaves nem o conteúdo da transcrição.

- [ ] **Step 1: Escrever os testes que falham** em `apps/worker/test/source-analyze.test.ts` (Postgres + MinIO; vídeos de `@central/media/test/fixtures` — exporte `makeVideo` por um subpath `@central/media/testing`; `Transcriber` e `LlmProvider` falsos que contam chamadas):
  - `vídeo com fala: probe, transcrição, sinais, IA e candidatos; status ready` — `CostLedger` com 1 lançamento `transcription` e 1 `llm`; `MediaAsset.sha256` igual ao sha256 do arquivo enviado e o objeto original no storage com o mesmo sha256 depois do job (original intacto, spec §11).
  - `vídeo sem áudio não chama o transcriber e gera candidatos` (Review Focus 2).
  - `retomada depois de falha na IA não repete transcrição nem custo` — LLM falso lança `LlmError` retryable na 1ª execução; segunda execução do handler: transcriber chamado **1** vez no total, `CostLedger` de transcrição com **1** linha, candidatos criados uma vez (Review Focus 3).
  - `segunda execução com a mesma entrada usa o cache de AiRun` — chame `retry` + handler de novo: LLM falso chamado 1 vez no total.
  - `orçamento esgotado: blocked_budget sem chamar transcriber nem LLM` — orçamento 0,01.
  - `IA sem candidatos válidos: failed com mensagem e custo registrado`.
  - `vídeo acima do limite: failed sem custo` — `deps.maxDurationMs` (padrão 2 h) = 1000 no teste, com vídeo de 3 s.
  - `três falhas transitórias seguidas: failed`.
  - `scratch é apagado mesmo com falha`.
- [ ] **Step 2: Rodar e ver falhar:** `pnpm --filter @central/worker test` → FAIL.
- [ ] **Step 3: Implementar** handler, config, registro na fila e as mudanças de Docker/compose/`.env.example`.
- [ ] **Step 4: Rodar:** `pnpm --filter @central/worker test` → PASS; `docker build -f docker/worker.Dockerfile -t central-worker:test .` → sucesso; dentro da imagem, o binário que `ffmpegPath()` resolve roda `-version` com código 0.
- [ ] **Step 5: Commit:** `feat(worker): pipeline de análise do cortador com retomada, cache de IA e orçamento`

---

### Task 10: Worker — download por link do YouTube (atrás de chave)

**Files:**
- Create: `apps/worker/src/handlers/source-download.ts`, `apps/worker/test/source-download.test.ts`, `apps/worker/test/fake-ytdlp.mjs`
- Modify: `apps/worker/src/worker.ts` (registra só com `YTDLP_ENABLED=true`, `concurrency: 1`), `docker/worker.Dockerfile` (baixa o binário `yt-dlp_linux` de uma release **fixada** com checksum SHA-256 conferido no build), `.env.example`, `docs/07-integracoes/youtube.md` (seção nova: download por ferramenta não oficial, termos, bloqueio de IP, chave desligada por padrão)

**Interfaces:**
- Produces: `createSourceDownloadHandler(deps: { db; storage; queue: JobQueue; ytdlpPath: string; ffmpegPath: string; scratchRoot: string; maxDurationMs: number; maxBytes: number; logger })`.

  Etapas: confere de novo `rightsBasis !== 'none'` (defesa em profundidade; `failed` se for); `downloading`; `yt-dlp --dump-single-json --no-playlist <url>` → `duration` > 2 h → `failed` "Vídeo acima de 2 h."; download com `-f "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]"`, `--merge-output-format mp4`, `--max-filesize 4G`, `--ffmpeg-location <ffmpegPath>`, `--no-playlist`, `-o <scratch>/original.%(ext)s`; `storage.uploadFile` para a chave da fonte; `queued` + envia `source.analyze`. Qualquer falha do yt-dlp → `failed` com **"Não foi possível baixar pelo link. Envie o arquivo MP4."** (sem retry automático: bloqueio de IP não melhora repetindo).

- [ ] **Step 1: Escrever os testes que falham** com `fake-ytdlp.mjs` (script node que imita `--dump-single-json` e grava um MP4 gerado por `makeVideo`; comportamento escolhido por variável de ambiente):
  - `link válido: baixa, sobe ao storage e enfileira a análise`.
  - `duração acima do limite: failed sem baixar`.
  - `yt-dlp sai com erro: failed com a mensagem que pede o MP4`.
  - `fonte reclassificada para none antes do job: failed sem chamar o yt-dlp`.
- [ ] **Step 2: Rodar e ver falhar:** `pnpm --filter @central/worker exec vitest run test/source-download.test.ts` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar:** `pnpm --filter @central/worker test` → PASS; `docker build -f docker/worker.Dockerfile .` → sucesso.
- [ ] **Step 5: Commit:** `feat(worker): download por link do YouTube atrás da chave YTDLP_ENABLED`

---

### Task 11: API web — fontes, candidatos, criadores parceiros e orçamento

**Files:**
- Create (todas com `defineApiHandler`, `requireActor`, `paramsValidated`/`readValidated` como na Fase 2):
  - `apps/web/server/api/orgs/[orgId]/sources/index.get.ts`, `index.post.ts` (upload: devolve `{ source, uploadId, partSize, partCount }`), `link.post.ts`
  - `.../sources/[sourceId]/index.get.ts`, `index.delete.ts` (abandona upload), `parts.post.ts` (`{ partNumbers }` → URLs), `complete.post.ts`, `rights.put.ts`, `retry.post.ts`, `player.get.ts`, `candidates.get.ts`
  - `.../candidates/[candidateId]/decision.post.ts` (`{ decision }`), `.../candidates/[candidateId]/index.patch.ts` (ajuste)
  - `.../partner-creators/index.get.ts`, `index.post.ts`, `[id].patch.ts`, `[id].delete.ts`
  - `.../evidence-upload.post.ts` (`{ contentType }` → `{ key, url }`, anexo da declaração ou da autorização do parceiro)
  - `.../budget.get.ts`
  - `apps/web/test/sources.test.ts`
- Modify: `apps/web/server/utils/services.ts` (instancia `sources`, `candidates`, `partnerCreators`), `apps/web/server/utils/config.ts` (`YTDLP_ENABLED` só para mostrar ou esconder o link; a rota de link usa `linkEnabled`), `compose.yaml`/`compose.prod.yaml` (`YTDLP_ENABLED` também no web, chave sem valor)
- Create também: `apps/web/server/api/config.get.ts` (exige sessão; devolve `{ linkUploadEnabled: boolean }`)

**Interfaces:**
- Consumes: serviços das Tasks 7 e 8. As mensagens de domínio já saem em pt-BR; os status HTTP seguem `toHttpError` (404 de outra organização, 403 de papel, 409 de conflito, 422 de validação).
- Corpo de `index.post.ts`: `{ title (1..200), fileName (1..255), sizeBytes (int > 0), contentType, rights, params? }` com `rights` validado por zod espelhando `RightsInput` e `params` com `targetMin/targetMax` em 1..20 e `minSec/maxSec` em 3..180 (`minSec < maxSec`, `targetMin ≤ targetMax`).

- [ ] **Step 1: Escrever os testes que falham** em `apps/web/test/sources.test.ts` (servidor real com Postgres + MinIO do `global-setup` da web):
  - `editor cria fonte, envia 2 partes pelas URLs devolvidas, completa e vê status queued`.
  - `fonte com rights none por link responde 422 e nenhuma fonte é criada`.
  - `link com YTDLP desligado responde 422`.
  - `viewer lista e vê candidatos, mas decision responde 403`.
  - `membro da org A recebe 404 em GET, rights, decision e PATCH de candidato da org B` (Review Focus 5; candidato da org B semeado direto no banco).
  - `PATCH de candidato com 2 s responde 422 com mensagem`.
  - `rights.put por editor 403; por aprovador 200 com histórico de 2 declarações`.
  - `budget.get devolve spentUsd e budgetUsd`.
  - `nenhuma resposta contém S3_SECRET_ACCESS_KEY` (varre os corpos das respostas do teste).
- [ ] **Step 2: Rodar e ver falhar:** `pnpm test:web` → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar:** `pnpm test:web` → PASS.
- [ ] **Step 5: Commit:** `feat(web): API do cortador — fontes, upload multipart, direitos, candidatos, parceiros e orçamento`

---

### Task 12: Telas "Cortes", configurações e documentação

**Files:**
- Create: `apps/web/app/pages/orgs/[orgId]/sources/index.vue`, `apps/web/app/pages/orgs/[orgId]/sources/[sourceId].vue`, `apps/web/app/components/RightsForm.vue`, `apps/web/app/components/CandidateCard.vue`, `apps/web/app/composables/useChunkedUpload.ts`, `apps/web/e2e/sources.spec.ts`, `docs/runbooks/storage-cors.md`
- Modify: `apps/web/app/layouts/default.vue` (item "Cortes"), `apps/web/app/pages/orgs/[orgId]/settings.vue` (seção "Criadores parceiros"), `docs/adr/0008-cortador-hibrido.md` e `0010-trava-de-direitos.md` (trocar "nada disso existe ainda no código" pelo que a Fase 3 entregou e o que fica para as Fases 4 e 5), `docs/05-modelo-de-dados.md` §2.7 (entidades implementadas), `docs/09-estrategia-ia.md` (tarefa `select_clips`), `docs/21-debitos-tecnicos.md` (fallback de transcrição, R6), `docs/17-roadmap-e-criterios-de-aceite.md` (Fase 3 entregue), `docs/runbooks/deploy.md` (variáveis novas e link para o runbook de CORS)

**Interfaces:**
- Consumes: rotas da Task 11.
- `useChunkedUpload(file: File, init: { partSize; partCount }, api: { presign(partNumbers): Promise<{partNumber,url}[]>; complete(parts): Promise<void> })` → `{ progress: Ref<number>; start(): Promise<void>; cancel(): void }` — partes em sequência, pede URLs em lotes de 10, até 3 tentativas por parte, lê o `ETag` do header (por isso o CORS, R2).

Telas (texto pt-BR; seguir o estilo de `accounts.vue` e `settings.vue`):
- **Lista de fontes:** botão "Novo corte" abre o formulário com título, arquivo (ou link, só quando `linkUploadEnabled`), `RightsForm` e "Opções" recolhíveis (quantidade alvo, faixa de duração, idioma). Cada fonte mostra título, status traduzido (`awaiting_upload` "Enviando", `queued` "Na fila", `downloading` "Baixando", `probing` "Lendo o vídeo", `transcribing` "Transcrevendo", `analyzing` "Escolhendo trechos", `ready` "Pronto", `failed` "Falhou", `blocked_budget` "Bloqueado: orçamento"), selo de direitos e contagem de candidatos. Atualiza a cada **5 s** enquanto alguma fonte está em processamento. Aviso no topo quando `budget.alert` ("Você já usou X% do orçamento de IA deste mês.").
- **`RightsForm`:** escolha da declaração com uma linha de explicação por opção; campos por regra (Task 7); `own` exige marcar "Declaro que o conteúdo é meu"; `none` mostra "Os cortes ficam só para estudo: não poderão ser publicados nem baixados."; texto fixo sob o formulário: "Sua declaração fica registrada com seu nome e a data. A responsabilidade por ela é sua." (spec §10 risco 5). Anexo de evidência pela rota `evidence-upload` (PUT direto na URL devolvida).
- **Detalhe da fonte:** status com `statusDetail` e "Tentar de novo" (em `failed`/`blocked_budget`), histórico de direitos com "Alterar declaração" (só para aprovador/admin), e a lista de `CandidateCard`: player `<video>` com a URL do player, começando em `startMs` e pausando em `endMs`; nota, motivo, título, layout (seletor), legendas por rede em abas só leitura; ações "Aceitar", "Rejeitar" e "Ajustar início/fim" (dois campos `mm:ss.d` + botão "Usar posição atual do player").
- **Configurações:** seção "Criadores parceiros" (lista, adicionar com nome, canais, link ou anexo de autorização, remover).

- [ ] **Step 1: Escrever o E2E que falha** `apps/web/e2e/sources.spec.ts` (sem worker no E2E):
  - `envia um MP4 pequeno com direitos "own" e a fonte aparece "Na fila"` — gere o MP4 com `makeVideo` no setup.
  - `"own" sem marcar a declaração mostra o erro e não envia`.
  - `candidatos semeados no banco: aceitar, rejeitar e ajustar para 0:10.0–0:40.0 atualizam o card` (fonte, asset e candidatos semeados direto com Prisma, como os testes da Fase 2).
- [ ] **Step 2: Rodar e ver falhar:** `pnpm test:e2e` → FAIL.
- [ ] **Step 3: Implementar** telas, componente, composable e documentação. O runbook `storage-cors.md` traz a regra de CORS do R2 (origem do painel; métodos `PUT`, `GET`; `ExposeHeaders: ETag`) e como conferir.
- [ ] **Step 4: Rodar a suíte inteira:** `pnpm lint && pnpm typecheck && pnpm format && pnpm test && pnpm test:web && pnpm test:e2e` → tudo PASS.
- [ ] **Step 5: Commit:** `feat(web): telas do cortador, criadores parceiros, runbook de CORS e docs da Fase 3`

---

## Validação manual do dono (fora do CI)

Os critérios da spec §11 que dependem da VPS e das APIs reais são conferidos pelo dono depois do deploy, com `ANTHROPIC_API_KEY` e `GROQ_API_KEY` configuradas:
- um MP4 de 30 a 60 min com fala gera **pelo menos 5 candidatos** com título e legenda por rede em **menos de 15 min** na VPS de referência;
- uma gameplay sem fala gera candidatos usando os sinais técnicos;
- o custo da fonte aparece no `CostLedger` e confere com os painéis da Anthropic e da Groq.

## Fora desta fase (para não confundir quem implementa)

- Renderização vertical, layouts, legenda queimada, `Clip`, bloqueio de download de corte de fonte `none` → **Fase 4**.
- Publicação, agendamento, cotas, créditos e hashtags fixas na legenda, bloqueio de agendamentos ao reclassificar para `none` → **Fase 5** (`assertPublishable` já fica pronto aqui).
- Retenção automática (apagar originais em 30/14 dias, spec §5.4.1) → Fase 4, junto com os cortes, que definem "último corte publicado".
- Fallback de transcrição (R6) → docs/21.
