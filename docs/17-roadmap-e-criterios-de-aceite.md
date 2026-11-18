# 17 — Roadmap de desenvolvimento e critérios de aceite

> **Roteiro revisado em 2026-11-17** (escopo v2: organizações e cortador de vídeos, [spec §9](superpowers/specs/2026-11-17-organizacoes-e-cortador-design.md)). As fases antigas de "Upload e biblioteca", "Processamento", "IA de metadados" e das integrações por rede ficam **absorvidas** pelo cortador (Fases 3 a 5). Grade e piloto automático, métricas e modo orgânico vêm depois.

Regra: **uma fase só começa quando os critérios de aceite da anterior forem validados** (demonstração + testes verdes + checklist assinado pelo dono do produto). Exceção deliberada: a **trilha paralela de credenciamento** (abaixo), que não é código e depende de prazos externos.

## Trilha paralela de credenciamento (inicia na Fase 1)

Prazos de aprovação das plataformas não são controláveis; começar cedo evita bloquear a Fase 5 (publicação).

| Item | Saída esperada |
|---|---|
| Meta | Por Business Manager que contém Páginas de organizações: app Meta Business; System User com acesso à Página e ao IG; **PoC manual** (Graph API Explorer/cURL) respondendo H1–H3 e H5 de [16 §5](16-riscos-e-limitacoes.md). Passo a passo e teste de "Live só com Standard Access" (❓, risco nº 1): [runbook Meta](runbooks/meta-app.md); o resultado vai na [ADR 0009](adr/0009-organizacoes-e-contas.md) |
| Google | Criar Gmail dedicado (2FA, no gerenciador de senhas) e **canal de marca** no YouTube; verificar o canal por telefone; adicionar gerentes (ADR 0006); projeto Cloud; Data API v3 + Analytics API habilitadas; consent screen *External / In production* + teste de refresh de 8 dias (H6); upload manual de teste com OAuth Playground. Passo a passo: [runbook Google](runbooks/google-oauth.md) |
| TikTok | Nada (manual assistido — ADR 0004) |
| Domínio | Domínio próprio para o painel (TLS via Caddy) |

---

## Fase 1 — Fundação e estrutura da aplicação (concluída, exceto o deploy)

**Escopo:** monorepo (pnpm), apps `web` (Nuxt 4) e `worker`, pacotes `core/db/shared/storage`; Docker Compose (Postgres, MinIO, web, worker, Caddy); Prisma com tabelas de identidade (`User`, `Brand`, `BrandMember`, `Setting`, `AuditLog`); pg-boss configurado com fila de exemplo; login + 2FA + papéis; logger estruturado; Sentry; `/api/health`; CI (lint, typecheck, testes, build); adaptador `fake` com interface `PlatformAdapter` definida; ADRs iniciais.

**Critérios de aceite:**
- [x] `docker compose up` sobe o ambiente local completo; `pnpm test` verde no CI.
- [x] Admin cria usuário, usuário faz login com 2FA; rotas negam acesso por papel (testes negativos).
- [x] Job de exemplo enfileirado na mesma transação de uma escrita de banco; rollback da transação não cria o job (teste).
- [x] Logs em JSON com `requestId`/`jobId`; segredo de teste não aparece nos logs (teste).
- [x] `/api/health` reporta Postgres, storage e heartbeat do worker.
- [ ] Deploy na VPS (ambiente de produção ainda vazio, ou staging se existir) via imagens do CI documentado e executado uma vez. **Pendente do dono**: o runbook existe ([deploy.md](runbooks/deploy.md)), mas não foi executado.

## Fase 2 — Organizações e contas vinculadas (implementada no ramo `fase-2-organizacoes`)

**Estado:** código implementado no ramo `fase-2-organizacoes`, **ainda não integrado à `main`**. Falta a validação do dono, incluindo a conexão real das contas e o teste do app Meta ([runbook](runbooks/meta-app.md), risco nº 1, ❓ ainda sem resultado na [ADR 0009](adr/0009-organizacoes-e-contas.md)). Nada aqui afirma que o app Meta pode ir para Live só com Standard Access.

**Escopo:** renomear `Brand` para `Organization` e adicionar os campos da organização; redação de tokens nos logs; serviço e API de organizações e membros; `SocialAccount` por organização e vínculo do @ do TikTok; conexão Meta (Instagram e Página do Facebook) por organização; conexão do canal do YouTube por OAuth; telas de organizações, configurações e contas; configuração de deploy, runbooks (Meta e Google) e ADRs 0008 a 0010. Decisões: [ADR 0009](adr/0009-organizacoes-e-contas.md).

**Critérios de aceite** (spec §11, parte desta fase):
- [ ] O admin cria duas organizações e vincula a cada uma o IG, a Página do FB, o canal do YouTube e o @ do TikTok.
- [ ] Uma organização não vê nada da outra (testado na API).
- [ ] Conta externa única por organização (`platform` + `externalId`).
- [ ] Credenciais cifradas e nunca expostas (API e logs).
- [ ] Validação do app Meta Live (risco nº 1), **executada pelo dono** e registrada na ADR 0009.

## Fase 3 — Cortador: análise e candidatos

**Escopo:** fonte (MP4 ou link do YouTube, `Source`) com **trava de direitos** ([ADR 0010](adr/0010-trava-de-direitos.md)); ffprobe; transcrição (`Transcriber`, Groq + fallback); sinais técnicos e amostragem de quadros; Claude escolhe os trechos ([ADR 0008](adr/0008-cortador-hibrido.md)); `ClipCandidate` com título e legenda por rede; `CostLedger` e orçamento por organização; tela de Cortes (aceitar, rejeitar, ajustar início e fim).

**Estado:** código e testes automáticos entregues no ramo `fase-3-cortador` (API, worker, telas e [runbook de CORS](runbooks/storage-cors.md)); **ainda não integrado à `main`**. Falta a validação do dono na VPS, com `ANTHROPIC_API_KEY` e `GROQ_API_KEY` reais: os dois primeiros critérios abaixo e a conferência do custo contra os painéis da Anthropic e da Groq. Sem fallback de transcrição ([docs/21](21-debitos-tecnicos.md), D3).

**Critérios de aceite** (spec §11):
- [ ] Um MP4 de 30 a 60 min com fala gera pelo menos 5 candidatos com título e legenda por rede em menos de 15 min na VPS de referência.
- [ ] Uma gameplay sem fala gera candidatos usando os sinais técnicos.
- [ ] Uma fonte `none` gera cortes, mas a API recusa a publicação e o download (teste). Nesta fase só `assertPublishable` está pronto; os pontos de saída (download do corte, publicar, agendar) chegam nas Fases 4 e 5.
- [x] O custo de IA de cada fonte aparece no `CostLedger`; o orçamento estourado bloqueia novas análises (testes do worker).

## Fase 4 — Cortador: renderização

**Escopo:** renderização vertical 1080×1920 (H.264 + AAC) com os layouts de reenquadramento (rosto, centro, jogo + facecam, vídeo inteiro com fundo desfocado), legenda queimada opcional, versões por rede, `Clip`; retenção de arquivos por organização; o original nunca é alterado.

**Critérios de aceite** (spec §11):
- [ ] Um corte aceito é renderizado em 1080×1920 com legenda queimada e o layout escolhido, e o original fica intacto (hash igual).
- [ ] Matar o worker durante a renderização → job refeito sem lixo no storage nem no scratch.

## Fase 5 — Publicação (IG, FB e YouTube automáticos; TikTok manual)

**Escopo:** adaptadores Instagram (Reels), Facebook (Reels, 3 a 90 s) e YouTube (Shorts) sobre as contas das organizações; `Publication`, aprovação, "publicar agora" e "agendar"; state machine, idempotência e reconciliação ([06](06-fluxos.md), [11](11-agendamento.md)); `QuotaUsage` e limite diário por conta; TikTok em modo manual assistido (baixar, copiar texto, colar URL); alerta quando o uso do dia passar de 80% do limite (YouTube: 100 uploads/dia por projeto). O pedido de aumento de cota só é feito se o volume somado das organizações se aproximar desse teto. A "validade do token" na tela Contas e a saúde dos tokens Meta/YouTube (aviso de expiração, renovação) ficam para esta fase.

**Pré-requisito:** resultado do teste Meta Live na ADR 0009. Se não for possível, IG e FB caem para manual assistido e o critério vira "publicação manual assistida funcionando, com o adaptador Meta pronto atrás de uma chave" ([spec §10](superpowers/specs/2026-11-17-organizacoes-e-cortador-design.md)).

**Critérios de aceite** (spec §11):
- [ ] Um corte aprovado é publicado de verdade no IG, no FB e no YouTube das contas vinculadas, sem duplicar mesmo com retry.
- [ ] Quando a cota do dia acaba (simulada em teste), as publicações seguintes ficam na fila para o próximo período, com aviso, e não falham.
- [ ] O TikTok fica com download e cópia do texto e com o registro da URL.
- [ ] Sem aprovação vigente, é impossível publicar (teste e UI).

## Fase 6 — Grade recorrente e piloto automático

Antes Fase 8. Escopo: agendamento com fuso da organização, grade recorrente, fila e alocador ([11 §7](11-agendamento.md), [ADR 0007](adr/0007-grade-recorrente-e-fila.md)), calendário, pausar/retomar/cancelar. Os critérios de aceite são os da antiga Fase 8 ([11 §6 e §7.7](11-agendamento.md)); serão revistos no mini-design da fase.

## Fase 7 — Métricas e analytics

Antes Fase 9. `fetchMetrics` nos adaptadores, `MetricSnapshot`, dashboard, comparativos e painel de monetização ([20 §4](20-monetizacao.md)). Critérios: os da antiga Fase 9, a rever no mini-design.

## Fase 8 — Evolução e otimizações

Backlog priorizado após a Fase 9, por exemplo:

- Relatório semanal com recomendações (Batch API) e sugestão de horários a partir do histórico.
- Ingestão por pasta monitorada / Google Drive / API de ingestão.
- Carrosséis e posts de imagem (IG/FB), vídeos longos no YouTube.
- Agendamento nativo opcional (YouTube `publishAt`, Facebook `scheduled_publish_time`).
- Modo orgânico (agente de notícias e posts de feed): [D1 em 21](21-debitos-tecnicos.md).
- Agentes autônomos **somente** onde houver tarefa aberta que justifique (ex.: pesquisa de pautas/tendências).
- OpenTelemetry; worker de mídia dedicado; avaliação de Redis/BullMQ conforme gatilhos de [03 §8](03-arquitetura.md).

**Critério de aceite geral:** cada item entra com seu próprio mini-design, critérios de aceite e testes, seguindo o mesmo processo.
