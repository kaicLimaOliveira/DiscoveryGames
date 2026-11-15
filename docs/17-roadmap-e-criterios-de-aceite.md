# 17 — Roadmap de desenvolvimento e critérios de aceite

Regra: **uma fase só começa quando os critérios de aceite da anterior forem validados** (demonstração + testes verdes + checklist assinado pelo dono do produto). Exceção deliberada: a **trilha paralela de credenciamento** (abaixo), que não é código e depende de prazos externos.

## Trilha paralela de credenciamento (inicia na Fase 1)

Prazos de aprovação das plataformas não são controláveis; começar cedo evita bloquear as Fases 5–7.

| Item | Saída esperada |
|---|---|
| Meta | No Business Manager existente (IG e Página já vinculados): app Meta Business; System User com acesso à Página e ao IG; **PoC manual** (Graph API Explorer/cURL) respondendo H1–H3 e H5 de [16 §5](16-riscos-e-limitacoes.md) |
| Google | Criar Gmail dedicado (2FA, no gerenciador de senhas) e **canal de marca** no YouTube; verificar o canal por telefone; adicionar gerentes (ADR 0006); projeto Cloud; Data API v3 + Analytics API habilitadas; consent screen *External / In production* + teste de refresh de 8 dias (H6); upload manual de teste com OAuth Playground |
| TikTok | Nada (manual assistido — ADR 0004) |
| Domínio | Domínio próprio para o painel (TLS via Caddy) |

---

## Fase 1 — Fundação e estrutura da aplicação

**Escopo:** monorepo (pnpm), apps `web` (Nuxt 4) e `worker`, pacotes `core/db/shared/storage`; Docker Compose (Postgres, MinIO, web, worker, Caddy); Prisma com tabelas de identidade (`User`, `Brand`, `BrandMember`, `Setting`, `AuditLog`); pg-boss configurado com fila de exemplo; login + 2FA + papéis; logger estruturado; Sentry; `/api/health`; CI (lint, typecheck, testes, build); adaptador `fake` com interface `PlatformAdapter` definida; ADRs iniciais.

**Critérios de aceite:**
- [ ] `docker compose up` sobe o ambiente local completo; `pnpm test` verde no CI.
- [ ] Admin cria usuário, usuário faz login com 2FA; rotas negam acesso por papel (testes negativos).
- [ ] Job de exemplo enfileirado na mesma transação de uma escrita de banco; rollback da transação não cria o job (teste).
- [ ] Logs em JSON com `requestId`/`jobId`; segredo de teste não aparece nos logs (teste).
- [ ] `/api/health` reporta Postgres, storage e heartbeat do worker.
- [ ] Deploy na VPS (ambiente de produção ainda vazio, ou staging se existir) via imagens do CI documentado e executado uma vez.

## Fase 2 — Upload e biblioteca de conteúdos

**Escopo:** `Content`, `MediaAsset` (original), `Game`, `Category`; upload multipart direto ao storage com URL pré-assinada; SHA-256; detecção de duplicidade; declarações de direitos; biblioteca com busca, filtros (jogo, categoria, status, data) e página de detalhe com player e histórico.

**Critérios de aceite:**
- [ ] Upload de arquivo de 1,5 GB com progresso e retomada após queda de rede.
- [ ] Original gravado em chave imutável; tentativa de sobrescrever falha (teste); hash registrado.
- [ ] Upload repetido do mesmo arquivo gera alerta `DUPLICATE_UPLOAD`.
- [ ] Declarações de direitos obrigatórias no formulário.
- [ ] Busca e filtros retornam resultados corretos em base com 500 conteúdos de teste (< 1 s).

## Fase 3 — Processamento e adaptação audiovisual

**Escopo:** pacote `media`; ffprobe → `MediaProbe`; validação genérica; `VideoConstraints` de cada plataforma preenchidas a partir de `07-integracoes/` (com fonte e data); estratégia passthrough/remux/transcode; presets versionados; deduplicação de renditions; thumbnails; amostragem de quadros; varredura de origem por metadados; histórico de processamento; fila `media` com concorrência controlada.

**Critérios de aceite:**
- [ ] Biblioteca de amostras de [10 §11](10-pipeline-audiovisual.md) produz a estratégia esperada em 100% dos casos.
- [ ] Toda rendition validada por ffprobe contra as constraints da plataforma de destino.
- [ ] Vertical H.264 conforme → passthrough (nenhum arquivo novo, nenhuma recompressão).
- [ ] Hash do original idêntico antes e depois do processamento.
- [ ] Vídeo de 2 min marcado como inelegível para Facebook Reels; elegível para IG e Shorts.
- [ ] Vídeo de 60 s 1080p processado (análise + renditions) em < 5 min na VPS de referência.
- [ ] Matar o worker durante um transcode → job retomado/refeito sem lixo no storage nem no scratch.

## Fase 4 — Geração de metadados com IA

**Escopo:** pacote `ai`; `LlmProvider` (Claude) e `Transcriber` (Groq + fallback); tarefas `analyze`, `fact_check`, `generate_copy`, `regenerate_copy`, `watermark_scan`; prompts versionados; validador determinístico por plataforma (`textRules` dos adaptadores); `AiRun`, `FactCheck`, `CostLedger`, orçamento; editor de publicações (textos por rede, histórico de versões); guia de voz da marca; conjunto golden de avaliação.

**Critérios de aceite:**
- [ ] Para 10 vídeos reais: transcrição pt-BR revisada como "utilizável" em ≥ 9 (H9).
- [ ] Textos gerados respeitam 100% dos limites (validador) após no máximo 1 correção automática.
- [ ] Eval golden: ≥ 70% dos textos aprovados sem edição pelo dono do produto; 0 fatos inventados nos casos-armadilha.
- [ ] Vídeo de notícia gera fact-check com fontes clicáveis; afirmação contradita gera alerta bloqueante.
- [ ] Regenerar uma plataforma com instrução cria nova versão sem alterar as outras.
- [ ] Custo por vídeo registrado e ≤ US$ 0,50; reprocessar sem mudanças não chama a API (cache).
- [ ] Orçamento a 100% bloqueia tarefas opcionais (teste).

## Fase 5 — Integração com Instagram e Facebook

**Escopo:** adaptadores Instagram (Facebook Login, IG vinculado à Página) e Facebook (`video_reels`), ambos com o **mesmo token de System User**; tela para cadastrar o token do System User e selecionar Página/IG; bloqueio de vídeos > 90 s no Facebook; modo manual assistido genérico (`awaiting_manual_post`); `Publication`, `CopyVersion`, `Approval`, `PublishAttempt`; central de aprovação; "publicar agora"; state machine completa com `progress`, retry, reconciliação; `QuotaUsage`; alertas; painel Saúde (parcial).

**Pré-requisito:** H1–H3 e H5 respondidas pela PoC da trilha paralela.

**Critérios de aceite:**
- [ ] Cadastrar o token do System User, selecionar Página FB e IG vinculado; desconectar; tokens cifrados; nada de token na API do painel.
- [ ] Vídeo de 2 min: Facebook indisponível para seleção com explicação; IG disponível.
- [ ] Publicação trocada para modo manual: baixar vídeo, copiar texto, colar URL → `published`.
- [ ] Publicar Reel aprovado no IG e no FB (contas reais de teste ou da marca) com legenda correta; `externalId` e URL registrados.
- [ ] Sem aprovação vigente → impossível publicar (teste e UI).
- [ ] Testes de falha de [14 §2.1](14-testes.md) passando para os dois adaptadores (0 duplicatas).
- [ ] FB indisponível (simulado) não impede publicação no IG; retentar o FB depois publica uma única vez.
- [ ] Limite de publicação do IG lido via API e exibido; limite de 30 Reels/24 h do FB controlado localmente.

## Fase 6 — Integração com YouTube

**Escopo:** adaptador YouTube (OAuth web server, upload resumable, `videos.insert` com `snippet`/`status`, `selfDeclaredMadeForKids`, `containsSyntheticMedia`, thumbnail após processamento); cota por projeto; reconciliação por `videoId`; opção (desligada) de agendamento nativo `publishAt`.

**Critérios de aceite:**
- [ ] Short publicado e classificado como Short pelo YouTube (vertical ≤ 3 min) com título/descrição/hashtags aprovados.
- [ ] Upload interrompido no meio retoma pela sessão resumable sem criar vídeo duplicado.
- [ ] Refresh token funcionando após 8 dias (H6).
- [ ] Consumo de cota registrado por projeto e exibido.
- [ ] Rótulo de mídia sintética enviado quando a declaração do conteúdo exigir.

## Fase 7 — Integração com TikTok

**Escopo (ADR 0004 — manual assistido):** adaptador `tiktok` em modo manual fixo (constraints de vídeo e regras de texto do TikTok para gerar rendition e legenda corretas); notificação no horário agendado (e-mail/Telegram/Discord) com link direto para a publicação; checklist do app (rótulo de IA, conteúdo de marca); validação da URL colada (formato de URL de vídeo do TikTok, única por publicação); registro manual opcional de métricas.

**Critérios de aceite:**
- [ ] Conteúdo aprovado para TikTok gera rendition e legenda válidas pelas regras do TikTok.
- [ ] No horário agendado, o responsável recebe notificação com link; baixa o vídeo e copia o texto em ≤ 2 cliques cada.
- [ ] Colar a URL marca a publicação como `published`; URL inválida ou já usada é recusada.
- [ ] Métricas manuais aparecem no dashboard marcadas como "manual".

## Fase 8 — Agendamento e publicação multiplataforma

**Escopo:** agendamento por publicação com timezone da marca; scheduler tick; pré-checagens T-30; pausar/retomar/cancelar; pausa global; `MISSED_WINDOW`; calendário mensal/semanal com arrastar e soltar; retentar falhas; horários padrão por plataforma; alertas de limites diários; **piloto automático** ([11 §7](11-agendamento.md), ADR 0007): `PostingSchedule`, `QueueEntry`, alocador, aprovação em lote, tela "Piloto automático", alertas de fila.

**Critérios de aceite:**
- [ ] Todos os cenários de [11 §6](11-agendamento.md) passam (automatizados com relógio controlado + 1 rodada real).
- [ ] Todos os cenários de [11 §7.7](11-agendamento.md) passam (grade + fila + alocador + concorrência).
- [ ] Rodada real de 7 dias: grades ativas em IG, FB e YT + lembretes do TikTok; publicações saem sozinhas na ordem da fila sem intervenção além da aprovação em lote.
- [ ] Um conteúdo agendado em 4 redes com horários diferentes publica cada uma no horário (± 2 min).
- [ ] Pré-checagem detecta token inválido 30 min antes e alerta.
- [ ] Calendário mostra plataforma, status e permite reagendar com confirmação.

## Fase 9 — Métricas e analytics

**Escopo:** `fetchMetrics` em todos os adaptadores; cronograma de coleta; `MetricSnapshot`/`AccountMetricSnapshot`; dashboard; comparativos; definições de métricas na UI; política de dados do YouTube (H8); relatório semanal (pode ficar para a Fase 10).

**Critérios de aceite:**
- [ ] Métricas coletadas para publicações reais nas 4 redes, nos horários do cronograma.
- [ ] Métrica indisponível aparece como "indisponível", nunca como zero.
- [ ] Dashboard exibe os indicadores de RF-UI-01 com dados reais.
- [ ] Comparativo "mesmo vídeo nas 4 redes" e "views em 72 h vs mediana da conta" funcionando.
- [ ] Tratamento de dados do YouTube conforme interpretação validada da política de 30 dias.
- [ ] Painel "Caminho para monetização" ([20 §4](20-monetizacao.md)) com metas editáveis e progresso por plataforma.

## Fase 10 — Evolução dos agentes e otimizações

Backlog priorizado após a Fase 9, por exemplo:

- Relatório semanal com recomendações (Batch API) e sugestão de horários a partir do histórico.
- Ingestão por pasta monitorada / Google Drive / API de ingestão.
- Carrosséis e posts de imagem (IG/FB), vídeos longos no YouTube.
- Agendamento nativo opcional (YouTube `publishAt`, Facebook `scheduled_publish_time`).
- UI multi-marca completa.
- Agentes autônomos **somente** onde houver tarefa aberta que justifique (ex.: pesquisa de pautas/tendências).
- OpenTelemetry; worker de mídia dedicado; avaliação de Redis/BullMQ conforme gatilhos de [03 §8](03-arquitetura.md).

**Critério de aceite geral:** cada item entra com seu próprio mini-design, critérios de aceite e testes, seguindo o mesmo processo.
