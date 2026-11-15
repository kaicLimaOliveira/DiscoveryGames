# 04 — Tecnologias e justificativas

Cada escolha foi avaliada por **benefício × custo × complexidade operacional** para uma operação interna pequena (1 marca, 1–3 vídeos/dia), mantida por poucas pessoas. Preços e fontes: [`_pesquisa/custos-infra-fontes.md`](_pesquisa/custos-infra-fontes.md).

## 1. Resumo da stack

| Camada | Escolha | Status |
|---|---|---|
| Linguagem | TypeScript (strict) em todo o projeto | Decidido |
| Runtime | Node.js LTS (24.x) | Decidido |
| Frontend + API | **Nuxt 4** (Vue 3 + Nitro), Nuxt UI | Decidido |
| Worker | Processo Node separado, mesmo monorepo | Decidido |
| Banco | **PostgreSQL 17** (self-hosted na VPS) | Decidido |
| ORM | **Prisma** | Decidido |
| Fila / agendamento | **pg-boss** (sobre o PostgreSQL) | Decidido |
| Redis | **Não usar no início** | Decidido (gatilho de adoção em [03 §8](03-arquitetura.md)) |
| n8n | **Não usar no núcleo** | Decidido |
| Mídia | **FFmpeg / ffprobe** (binários estáticos na imagem Docker) | Decidido |
| Storage | **Cloudflare R2** (prod) / **MinIO** (dev), via API S3 | Decidido |
| LLM | **Claude** (Anthropic API) atrás de interface `LlmProvider` | Decidido |
| Transcrição | **Groq Whisper large-v3-turbo** (principal) + OpenAI `gpt-4o-mini-transcribe` (fallback), atrás de `Transcriber` | Decidido (validar qualidade pt-BR na Fase 4) |
| Verificação factual | Ferramenta **web search da Claude API** | Decidido (alternativa: Tavily) |
| Hospedagem | 1 VPS 4 vCPU / 8 GB, Docker Compose, Caddy | Decidido (provedor: ver §10) |
| Observabilidade | pino (logs JSON) + Sentry + Uptime externo + painel interno | Decidido |
| Testes | Vitest, Playwright, Testcontainers, MSW/nock | Decidido |
| Monorepo | pnpm workspaces (+ Turborepo opcional) | Decidido |

## 2. Nuxt 4 (frontend + API)

**Por quê:** foi a sugestão do briefing e é tecnicamente adequada: um único projeto entrega o painel (SSR/SPA) e as rotas de API (Nitro), com TypeScript ponta a ponta e tipos compartilhados com o worker. Nuxt UI dá componentes prontos (tabelas, formulários, modais, calendário via biblioteca) para um painel administrativo.

**Alternativas avaliadas:**

| Alternativa | Por que não |
|---|---|
| Next.js | Equivalente técnico; nenhuma vantagem para este caso que compense trocar a preferência declarada |
| SPA (Vite) + API separada (Fastify/NestJS) | Dois projetos e dois deploys sem necessidade; NestJS adiciona cerimônia |
| Painel low-code (Retool, Appsmith) | Editor de publicações, calendário e player personalizados ficariam limitados; outra plataforma para manter |

**Cuidados:** a API do Nitro só faz trabalho leve (CRUD, OAuth, URLs pré-assinadas, enfileirar). Nada de FFmpeg ou chamadas longas de IA dentro de uma requisição HTTP.

Bibliotecas de apoio: `nuxt-auth-utils` (sessão selada em cookie), `zod` (validação), `@vueuse/core`, um componente de calendário (ex.: FullCalendar Vue ou `vue-cal`) e um player HTML5 nativo.

## 3. PostgreSQL + Prisma

**PostgreSQL:** dados relacionais (conteúdo → publicações → tentativas → métricas), transações para mudar estado + enfileirar atomicamente, `jsonb` para campos por plataforma, e serve também de fila (pg-boss). Um único banco para operar e fazer backup.

**Self-hosted vs gerenciado:** self-hosted na VPS (custo zero, latência zero). Bancos serverless (Neon etc.) ficariam sempre ligados por causa do *polling* da fila, sem economia real. Backup diário para o R2 (`pg_dump` + retenção). Rever se a disponibilidade exigir réplica.

**Prisma:** migrações versionadas, tipos gerados, boa ergonomia; foi sugerido no briefing. Para consultas analíticas (dashboards) usa-se SQL tipado (`$queryRaw` com tipos/`TypedSQL`). **Alternativa considerada:** Drizzle (mais leve, SQL-first) — igualmente válida; Prisma escolhido pela maturidade das migrações e familiaridade. A troca é localizada no pacote `db`.

## 4. Fila: pg-boss (e por que não Redis/BullMQ agora)

| Requisito | pg-boss atende? |
|---|---|
| Persistência / sobreviver a reinício | Sim (tabelas no Postgres) |
| Retry com backoff exponencial | Sim (`retryLimit`, `retryDelay`, `retryBackoff`) |
| Execução futura (agendamento) | Sim (`startAfter`) |
| Cron | Sim (`schedule`) |
| Deduplicação | Sim (`singletonKey`) |
| Concorrência por fila | Sim (configurável por worker) |
| Concorrência por conta social | Via `singletonKey`/política de fila + lock condicional no domínio |
| Enfileirar na mesma transação do estado | Sim (aceita executar com a conexão/transação do chamador) |

**Redis + BullMQ** traria rate limiter nativo e UI de filas, mas exige mais um serviço com persistência e backup. Para 1–3 vídeos/dia não compensa. O `core` usa uma interface `JobQueue` para que a troca seja localizada.

## 5. n8n

**Avaliação:** n8n é ótimo para integrações rápidas e visíveis, mas o núcleo deste sistema exige idempotência, state machines, testes automatizados, versionamento em Git e controle fino de concorrência — exatamente onde fluxos visuais são frágeis e difíceis de testar. **Decisão:** não usar no núcleo. Uso opcional futuro na periferia (ex.: receber arquivos de uma pasta do Google Drive e chamar a API de ingestão da central — RF-ING-07).

## 6. FFmpeg / ffprobe

Padrão de fato para análise e transcodificação; suporta tudo que as plataformas exigem (H.264/H.265, AAC, MP4 com `faststart`). Executado via `child_process.spawn` com argumentos montados a partir de presets tipados (nunca concatenação de strings de shell). **Não usar `fluent-ffmpeg`** (projeto arquivado). Binários estáticos fixados por versão na imagem Docker do worker para reprodutibilidade. Detalhes em [10](10-pipeline-audiovisual.md).

Alternativas descartadas: serviços de transcodificação na nuvem (AWS MediaConvert, Mux, Cloudflare Stream) — custo recorrente e menos controle sobre "não recomprimir"; desnecessários neste volume.

## 7. Storage: Cloudflare R2

- Compatível com S3 (SDK `@aws-sdk/client-s3`), **sem custo de egress** — relevante porque as redes baixam o vídeo e o painel faz streaming para preview.
- US$ 0,015/GB-mês, 10 GB grátis; custo estimado < US$ 1/mês no volume inicial.
- **Entrega às plataformas:** upload direto de bytes (Instagram resumable, Facebook `rupload`, YouTube resumable) — nenhum arquivo fica público. O TikTok é manual assistido (download pelo painel via URL pré-assinada curta). Se no futuro a integração automática do TikTok via API for Business for adotada, ela exigirá um bucket de entrega com domínio próprio verificado (ver [tiktok.md](07-integracoes/tiktok.md) §17).
- Dev: MinIO em container.

## 8. IA

Ver [09](09-estrategia-ia.md). Resumo: Claude (`claude-opus-5-5` para análise/copy/fact-check com *effort* baixo/médio; `claude-haiku-5-5` para tarefas simples de visão/classificação), saída estruturada, prompt caching, Batch API para relatórios.

**Transcrição:** Groq `whisper-large-v3-turbo` (US$ 0,04/hora de áudio, muito rápido, qualidade do large-v3) como principal; OpenAI `gpt-4o-mini-transcribe` (US$ 0,003/min) como fallback. Local (faster-whisper) descartado inicialmente: consumiria CPU da mesma VPS do FFmpeg e a qualidade em pt-BR com gírias de games nos modelos menores é inferior. **Validar na Fase 4** com 10 vídeos reais.

**Busca factual:** web search da própria Claude API (US$ 10/1.000 buscas → ~US$ 5/mês no pior caso estimado) — mantém um único fornecedor e devolve citações integradas à resposta. Alternativa se o custo importar: Tavily (camada gratuita cobre o volume).

## 9. Observabilidade

| Ferramenta | Uso | Custo |
|---|---|---|
| pino | Logs JSON estruturados, com redação de campos sensíveis | grátis |
| Sentry | Exceções do web e do worker, com contexto | plano gratuito |
| Uptime externo (Better Stack ou UptimeRobot) | Ping no `/api/health` | plano gratuito |
| Painel interno "Saúde" | Filas, falhas, cotas, tokens, custos (dados do próprio Postgres) | — |
| OpenTelemetry | Opcional (Fase 10) se houver backend | — |

Detalhes em [12](12-monitoramento.md).

## 10. Hospedagem

| Opção | Configuração | Preço (nov/2026) | Observação |
|---|---|---|---|
| **Hetzner CPX32 (Helsinque)** | 4 vCPU AMD, 8 GB, 160 GB | €30,49/mês | **Recomendada**: preço estável, boa CPU para FFmpeg; latência maior para o Brasil é irrelevante (tráfego é servidor ↔ APIs) |
| Hetzner CX33 | 4 vCPU compartilhada, 8 GB, 80 GB | €8,99/mês | Ótima se houver estoque |
| Hostinger KVM 4 (Brasil) | 4 vCPU, 16 GB, 200 GB | R$ 59,99 promo / R$ 149,99 renovação | Alternativa nacional; atenção ao preço de renovação |
| DigitalOcean | 4 vCPU / 8 GB | US$ 48/mês | Mais cara |

Requisitos mínimos: 4 vCPU, 8 GB RAM, 80 GB disco (scratch do FFmpeg + Postgres), Docker. Os vídeos ficam no R2, não no disco da VPS.

**Deploy:** imagens Docker construídas no CI (GitHub Actions) e publicadas num registry; na VPS, `docker compose pull && up -d` com migrações rodando como passo explícito antes de subir a nova versão. Caddy cuida de TLS automático.

## 11. Ferramentas de engenharia

| Tema | Escolha |
|---|---|
| Lint/format | ESLint + Prettier (ou Biome) |
| Testes | Vitest (unit/integração), Testcontainers (Postgres/MinIO reais), MSW/nock (HTTP das plataformas), Playwright (E2E do painel) |
| CI | GitHub Actions: lint, typecheck, testes, build de imagens |
| Segredos no CI/VPS | Variáveis do GitHub Actions + arquivo `.env` com permissão restrita na VPS (ou SOPS/age) |
| ADRs | `docs/adr/NNNN-titulo.md` |
