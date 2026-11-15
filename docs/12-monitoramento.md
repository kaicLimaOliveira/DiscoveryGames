# 12 — Monitoramento: métricas de conteúdo e observabilidade do sistema

Dois assuntos:

- **Parte A — métricas de desempenho das publicações** (o que o negócio quer saber).
- **Parte B — observabilidade técnica** (se o sistema está saudável).

---

## Parte A — Métricas de conteúdo

### A.1 Disponibilidade real por plataforma

Resumo das análises oficiais (detalhes e nomes exatos nos arquivos de `07-integracoes/`). "—" = não disponível via API oficial pesquisada.

| Métrica desejada | Instagram Reels | Facebook Reels | TikTok (Content Posting/Display) | YouTube Shorts |
|---|---|---|---|---|
| Visualizações | `views` | métricas de vídeo/Reels (em transição para `*_media_view`) | `view_count` | `views`, `engagedViews` (Analytics); `viewCount` (Data API) |
| Curtidas | `likes` | sim (reações) | `like_count` | `likes` |
| Comentários | `comments` | sim | `comment_count` | `comments` |
| Compartilhamentos | `shares` | sim | `share_count` | `shares` |
| Salvamentos | `saved` | ❓ | — | — |
| Alcance | `reach` | ❓ (alcance em descontinuação parcial na Meta) | — | — |
| Tempo médio assistido | `ig_reels_avg_watch_time` | `post_video_avg_time_watched` | — (Accounts API: sim) | `averageViewDuration` |
| Retenção | `reels_skip_rate` (proxy) | `post_video_retention_graph` | — (Accounts API: sim) | `averageViewPercentage`, curva via `elapsedVideoTimeRatio` |
| Seguidores ganhos | conta: `follows_and_unfollows` | ❓ | — | `subscribersGained` |
| Latência dos dados | até 48 h | ❓ | ❓ (apenas vídeos públicos) | Analytics 48–72 h; Data API quase imediato |

**TikTok está em modo manual assistido (ADR 0004): não há coleta automática.** O painel permite registrar métricas manualmente (views, curtidas, comentários, compartilhamentos) por publicação, marcadas como `source = manual`. A coluna TikTok acima mostra o que a Content Posting/Display API ofereceria. Se a **Accounts API da API for Business** for adotada no futuro, `/business/video/list/` acrescenta alcance, tempo médio assistido, % de visualização completa, retenção por segundo, origem de tráfego e audiência, com atraso de 24–48 h; algumas métricas exigem nível de acesso/conta verificada (ver [tiktok.md](07-integracoes/tiktok.md) §17).

**Regras de apresentação:**

- Valor `null` = "indisponível nesta plataforma" (ícone "–" com tooltip), nunca zero.
- Comparações entre plataformas usam somente métricas que existem nas duas e com definições compatíveis; a UI mostra a definição de cada métrica (ex.: "view" do YouTube Shorts conta replays; `engagedViews` não).
- Mudanças de definição pelas plataformas (ex.: YouTube mudou contagem de views em 2025 e 2026; Meta depreciou `plays`/`impressions`) são registradas em `MetricDefinitionChange` (tabela simples) e sinalizadas nos gráficos.

### A.2 Coleta

- Cronograma por publicação: +1 h, +6 h, +24 h, +72 h, +7 d, +28 d; depois semanal até 90 d; depois mensal.
- YouTube: Data API (`videos.list` statistics, barato) nas coletas iniciais; Analytics API a partir de +72 h para retenção e tempo médio.
- Instagram: snapshots periódicos (a API não fornece série temporal por mídia).
- Respeito a limites: fila `metrics` com concorrência 2, agrupando IDs por chamada quando a API permitir.
- Política do YouTube: dados autorizados armazenados devem ser atualizados ou removidos a cada 30 dias → o próprio cronograma de coleta atualiza o snapshot mais recente; para snapshots históricos, ver [16](16-riscos-e-limitacoes.md) (item a validar juridicamente/na política).

### A.3 Análises e painéis

| Visão | Conteúdo |
|---|---|
| Dashboard | Publicados (período), agendados, falhas abertas, views acumuladas por plataforma, top 10 conteúdos (por métrica escolhida), custo de IA do mês |
| Por publicação | Curva de views ao longo do tempo (snapshots), métricas atuais, comparação com a mediana da conta na mesma idade (ex.: views em 24 h vs mediana em 24 h) |
| Por conteúdo | As 4 plataformas lado a lado (mesmo vídeo, desempenho diferente) |
| Comparativos | Por plataforma × categoria × jogo × dia da semana × hora; métricas normalizadas por idade do post |
| Relatório semanal | Gerado por IA (Batch API) com números de base e recomendações ([09 §3.6](09-estrategia-ia.md)) |

Indicador principal recomendado para comparar conteúdos: **views em 72 h relativas à mediana da conta** (remove efeito do tamanho da conta e da idade do post).

---

## Parte B — Observabilidade técnica

### B.1 Logs

- pino, JSON, nível `info` em produção.
- Campos obrigatórios: `ts`, `level`, `service` (`web`|`worker`), `msg`, `requestId` ou `jobId`, e quando aplicável `brandId`, `contentId`, `publicationId`, `platform`, `step`, `attempt`, `durationMs`.
- Redação de segredos ([13 §7](13-seguranca.md)).
- Saída: stdout → `docker logs` com rotação (`max-size`); envio opcional para um agregador (Better Stack/Axiom/Grafana Loki) quando necessário.

### B.2 Erros

- Sentry no `web` (servidor e cliente) e no `worker`, com tags `platform`, `jobName`, `publicationId`. Sem dados sensíveis (`beforeSend` filtra).

### B.3 Saúde e métricas operacionais (painel interno "Saúde")

| Indicador | Fonte | Alerta |
|---|---|---|
| Jobs por fila: pendentes, ativos, falhos, idade do mais antigo | tabelas pg-boss | fila `publish` com job > 10 min pendente; `media` > 30 min |
| Publicações `needs_attention` / `unknown` | `Publication` | qualquer nova |
| Publicações agendadas nas próximas 24 h com pré-checagem falhando | job preflight | imediato |
| Tokens expirando em < 7 dias / contas `needs_reauth` | `OAuthCredential`, `SocialAccount` | diário |
| Cota por plataforma (uso/limite) | `QuotaUsage` | > 80% |
| Custo de IA do mês vs orçamento | `CostLedger` | > 80% e 100% |
| Disco da VPS, uso de CPU/memória | node-exporter ou script simples | disco > 80% |
| Último backup bem-sucedido | job backup | > 26 h |
| Disponibilidade externa | uptime monitor em `/api/health` | 2 falhas seguidas |

`/api/health` verifica: conexão com Postgres, acesso ao R2 (HEAD em objeto sentinela), worker vivo (heartbeat gravado a cada 30 s).

### B.4 Canais de alerta

E-mail + um canal instantâneo (Telegram ou Discord via webhook), configuráveis em Configurações. Alertas agregados (no máximo 1 por tipo a cada 15 min) para não gerar ruído.

### B.5 Rastreamento

OpenTelemetry é opcional (Fase 10). Até lá, o `jobId`/`publicationId` em todos os logs + `PublishAttempt` + `AiRun` fornecem o rastreio ponta a ponta de qualquer publicação.
