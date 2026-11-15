# 07.0 — Estratégia de integração e camada de abstração

As análises detalhadas de cada API oficial estão em:
[instagram.md](instagram.md) · [facebook.md](facebook.md) · [tiktok.md](tiktok.md) · [youtube.md](youtube.md).
Este documento define **como** o sistema conversa com todas elas de forma uniforme.

## 1. Princípios

1. **Somente APIs oficiais.** Automação de navegador não é usada como solução principal.
2. **Uma publicação = uma máquina de estados retomável.** Cada passo externo salva o seu resultado (`Publication.progress`) **antes** do passo seguinte.
3. **Plataformas independentes.** Falha, cota ou indisponibilidade em uma plataforma não bloqueia as outras.
4. **Conhecimento da plataforma vive no adaptador.** O núcleo não sabe o que é "container" do Instagram ou "publish_id" do TikTok.
5. **Capacidades declaradas, não presumidas.** Cada adaptador declara o que suporta (formatos, agendamento nativo, capa, métricas, limites) e o núcleo/UI se adaptam.

## 2. Interface `PlatformAdapter` (contrato de design)

> Descrição de contrato para orientar a implementação, não código final.

| Membro | Responsabilidade |
|---|---|
| `id` | `'instagram' \| 'facebook' \| 'tiktok' \| 'youtube' \| 'fake'` |
| `capabilities(account)` | Formatos suportados; `supportsNativeSchedule`; `supportsCover` (imagem ou offset); `uploadModes` (`bytes`, `url`); métricas disponíveis; requisitos de UX (ex.: TikTok exige escolha de privacidade sem default) |
| `videoConstraints(format)` | `VideoConstraints` com fonte oficial e data (ver [10 §5](../10-pipeline-audiovisual.md)) |
| `textRules(format)` | Limites de título/legenda/descrição (e unidade: caracteres ou bytes), nº máximo de hashtags, campos obrigatórios |
| `optionsSchema(format)` | Schema (zod) de `Publication.platformOptions` — ex.: privacidade, `share_to_feed`, `selfDeclaredMadeForKids`, `containsSyntheticMedia`, `is_ai_generated`, dueto/stitch |
| `oauth.authorizeUrl(state, pkce)` / `oauth.exchange(code)` / `oauth.refresh(cred)` / `oauth.revoke(cred)` | Ciclo de vida das credenciais |
| `listConnectableAccounts(cred)` | Ex.: páginas do usuário (Meta), canais (YouTube) |
| `healthCheck(account)` | Token válido? escopos? conta restrita? |
| `preflight(ctx)` | Valida token, cota disponível, capacidades atuais (ex.: TikTok `creator_info`), rendition e textos |
| `publishStep(ctx, progress)` | Executa **o próximo passo** a partir do `progress` e devolve `{ progress, done, externalId?, externalUrl? }` ou um erro classificado |
| `reconcile(ctx, progress)` | Determina se o post existe quando o resultado foi incerto (`found` / `not_found` / `inconclusive`) |
| `fetchMetrics(account, externalIds[])` | Métricas normalizadas + `raw`; métricas indisponíveis = `null` |
| `fetchAccountMetrics(account)` | Seguidores/inscritos etc. |
| `quotaState(account)` | Uso/limite conhecido (da API quando há endpoint; estimado pelo `QuotaUsage` quando não há) |
| `classifyError(err)` | Mapeia erro HTTP/código da plataforma → `TransientError` / `RateLimitError(retryAfter)` / `AuthError` / `PermanentError` / `PolicyError` / `UnknownOutcomeError` |

Registro: `platformRegistry.register(adapter)`. Adicionar uma plataforma (ex.: Kwai, X, Threads) = implementar este contrato + presets de mídia + regras de texto. Nenhuma mudança em `core`, banco ou fluxo de aprovação.

## 3. Estratégia por plataforma (resumo das decisões)

| | Instagram | Facebook (Página) | TikTok | YouTube |
|---|---|---|---|---|
| API | Instagram API with Facebook Login (IG vinculado à Página) | Graph API — Page `video_reels` | **Nenhuma (manual assistido, §4–5)** | Data API v3 + Analytics API |
| Login | **Mesmo System User do Business Manager** (token único para IG + FB) | System User do Business Manager | — | OAuth 2.0 web server, refresh token |
| Envio do vídeo | Upload resumable (`rupload`) | Upload binário via `rupload` | Download pelo painel; pessoa posta no app | Upload resumable |
| Agendamento | Próprio | Próprio (nativo existe: 10 min–29 dias; não usado inicialmente) | Lembrete no horário (notificação) | Próprio; **opção** nativa `publishAt` |
| Idempotência | Container id persistido + reconciliação por mídia recente | `video_id` persistido + status | URL colada é única por publicação | Sessão resumable + `videoId` persistidos |
| Limite principal | Limite de publicações por 24 h (consultável via API) | 30 Reels via API / Página / 24 h; **só vídeos de 3–90 s** | — | 100 uploads/dia **por projeto** Google (compartilhado entre canais) |
| Métricas | Insights de mídia | Insights de vídeo (métricas em transição na Meta) | Sem API; registro manual opcional | Analytics (48–72 h de atraso) + `videos.list` imediato |

**Decisões do dono do produto (2026-11-15):** IG e Página FB já estão no mesmo Business Manager com o IG vinculado à Página → um único System User atende os dois (Unified Login fica como alternativa avaliada, não implementada). Vídeos > 90 s **não** são publicados no Facebook. TikTok em **modo manual assistido** (a empresa não atende hoje os requisitos de registro da API for Business).

## 4. TikTok — ponto de decisão

A pesquisa ([tiktok.md](tiktok.md)) encontrou que as diretrizes da **Content Posting API** classificam como não aceitáveis ferramentas para postar em contas "que você ou sua equipe gerencia" e exigem que apps não sejam de uso privado. Sem auditoria, posts ficam restritos a privado (`SELF_ONLY`). Rotas possíveis, a decidir com o dono do produto (registrar a decisão em ADR):

| Rota | Como funciona | Prós | Contras |
|---|---|---|---|
| A. Content Posting API — Direct Post | App auditado posta direto | Automação completa | Uso interno é explicitamente o caso que a diretriz rejeita; alto risco de reprovação |
| B. Content Posting API — Upload (inbox) | Envia rascunho; humano finaliza no app TikTok | Combina com aprovação humana | App ainda passa por revisão; mesmo risco de enquadramento; 5 rascunhos pendentes/24 h |
| C. **TikTok API for Business — Accounts API** (conta própria) | `/business/video/publish/` publica post **público** em conta própria; status por `/business/publish/status/` e webhooks `post.publish.*` | Feita para "owned accounts"; o cadastro do app prevê "internal organizational use"; métricas ricas (retenção por segundo, tempo médio, alcance, origem de tráfego) | Registro exige **empresa** (e-mail corporativo + site); revisão (2–3 dias úteis) + formulário de acesso à Accounts API; só aceita `video_url` de **domínio verificado**; sem campo de privacidade nem agendamento; 15 posts/dia/conta |
| D. Manual assistido | Central prepara vídeo + texto; humano baixa/posta; cola o link para métricas | Zero risco de API; disponível no dia 1 | Um passo manual; métricas dependem de API de leitura |

**Decisão (ADR 0004):** rota **D — manual assistido**. Rotas A e B descartadas pelo enquadramento das diretrizes; rota C (Accounts API) é tecnicamente a melhor, mas exige registro como empresa (e-mail corporativo + site), que a operação não atende hoje. **Gatilho para reavaliar:** se a empresa passar a atender os requisitos, implementar a rota C como novo modo do adaptador TikTok (o resto do sistema não muda); isso exigirá um bucket de entrega com domínio verificado. Detalhes em [tiktok.md](tiktok.md) §17.

## 5. Modo "manual assistido" (genérico)

Útil para TikTok e como contingência para qualquer rede:

1. Publicação aprovada com `Publication.mode = manual`; ao chegar a vez (`queued`) vai para `awaiting_manual_post` em vez de chamar o adaptador.
2. Painel mostra: botão "baixar vídeo", texto pronto com botão "copiar", checklist de opções (privacidade, rótulo de IA, conteúdo de marca).
3. No horário agendado, notificação (e-mail/Telegram) para o responsável.
4. Responsável publica no app e cola a URL do post → `published` com `externalUrl`.
5. Se houver API de leitura autorizada, o sistema resolve o ID e coleta métricas; senão, métricas manuais opcionais.

## 6. Limites de taxa e cotas

- Cada adaptador implementa um *token bucket* local por conta/app com os limites documentados e respeita `Retry-After`/cabeçalhos de uso (ex.: cabeçalhos de uso de BUC da Meta).
- `QuotaUsage` é atualizado após cada chamada que consome cota (estimado) e reconciliado com endpoints oficiais quando existem (ex.: limite de publicação do Instagram).
- O agendador alerta ao agendar além da capacidade do dia.
- YouTube: cota é do **projeto Google**, compartilhada por todos os canais conectados — o `QuotaUsage` do YouTube é por projeto, não por conta.

## 7. Classificação de erros (padrão)

| Situação | Classe | Ação |
|---|---|---|
| Timeout de rede, 5xx, "temporarily unavailable" | Transient | Retry com backoff (30 s, 2 min, 8 min, 30 min, 2 h) + jitter |
| 429 / limite de taxa / cota diária | RateLimit | Esperar `Retry-After` ou até a janela renovar; não conta como falha definitiva |
| Token expirado/revogado, escopo ausente | Auth | Tentar refresh 1×; senão `needs_attention` + conta `needs_reauth` + alerta |
| Vídeo rejeitado (formato/duração), texto acima do limite | Permanent | `needs_attention`; corrigir rendition/texto |
| Violação de política / spam / conta restrita | Policy | `needs_attention`; alerta prioritário; **sem** retry automático |
| Timeout **após** chamada que cria/publica | UnknownOutcome | `unknown` → reconciliação |

Mapeamentos de códigos específicos de cada API ficam nas seções de erros de cada análise e nas fixtures de teste.

## 8. Ordem de implementação

Fase 5: Instagram + Facebook (mesmo app Meta, mesmo System User) + modo manual genérico. Fase 6: YouTube. Fase 7: TikTok em modo manual assistido (adaptador `tiktok` com `capabilities.uploadModes = []` e `mode = manual` fixo). O adaptador `fake` existe desde a Fase 1 para desenvolver o painel e os fluxos sem depender de aprovações.
