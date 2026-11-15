# TikTok — Análise da API oficial

> **Decisão do projeto (ADR 0004): TikTok em modo manual assistido — esta análise fica como referência para reavaliação futura.**
>
> Pesquisado em 2026-11-15. Legenda: ✅ Confirmado · 🔒 Depende de aprovação · ❓ Hipótese a validar
>
> Método: leitura das páginas oficiais em developers.tiktok.com (via WebFetch). Todas as páginas citadas como ✅ foram lidas nesta data. Páginas que não puderam ser lidas estão indicadas explicitamente. Os códigos [F1], [F2]... remetem à seção 16.

---

## 1. Resumo executivo

- ⚠️ **Risco nº 1 (bloqueante para auditoria):** as Content Sharing Guidelines classificam explicitamente como **"Not acceptable"** *"A utility tool to help upload contents to the account(s) you or your team manages"* e dizem que os clientes *"should be intended for a wide audience, not limited to internal groups/private use"*. As App Review Guidelines dizem: *"Apps must not be for private or personal use."* Ou seja, **o nosso caso de uso (central interna para as contas do mesmo dono) é exatamente o perfil que o TikTok diz que não aprova** ✅ [F4][F12].
- Sem auditoria, o cliente é "unaudited": posts só em `SELF_ONLY` (privado), até 5 usuários postando em 24h, e as contas precisam estar **privadas** no momento do post (a API bloqueia contas públicas com `unaudited_client_can_only_post_to_private_accounts`) ✅ [F1][F2][F4]. **Na prática, Direct Post público não é viável para nós sem auditoria.**
- Existem dois modos: **Direct Post** (`video.publish`, publica direto no perfil) e **Upload/inbox** (`video.upload`, envia rascunho; o humano finaliza no app do TikTok) ✅ [F2][F6]. O modo Upload não exige o post público via API e casa bem com "humano aprova", mas também exige app aprovado para o escopo `video.upload` 🔒 [F6].
- **Não existe agendamento nativo** documentado na Content Posting API: o agendamento precisa ser feito pelo nosso sistema (fila + job que chama o `init` na hora) ❓/✅ (ausência confirmada nas páginas lidas) [F1][F2][F4].
- Publicação é **assíncrona**: `init` → (upload PUT em chunks) → status via polling `/v2/post/publish/status/fetch/` ou webhooks `post.publish.*` ✅ [F1][F5].
- Tokens: access token **2 h** (doc em texto) e refresh token **180 dias**, com **rotação do refresh token a cada refresh**. Os exemplos da doc mostram valores diferentes (86400 / 31536000) → usar sempre `expires_in`/`refresh_expires_in` da resposta ✅ [F8][F9][F10].
- Métricas via API (Display API `video.list`/`video.query`): apenas `view_count`, `like_count`, `comment_count`, `share_count` (+ metadados). **Sem retenção, tempo médio assistido, alcance, origem de tráfego** ✅ [F15][F16][F17]. Métricas avançadas só via TikTok API for Business (Organic/Accounts API) — documentação oficial não pôde ser lida ❓ [F23].
- Limite de ~**15 posts/dia por conta criadora**, compartilhado entre todos os clientes Direct Post; Upload: máx. **5 rascunhos pendentes em 24h** ✅ [F4][F6].
- Termos do Developer proíbem adicionar marca d'água/logo/branding promocional no conteúdo do usuário e uso comercial sem consentimento escrito ✅ [F4][F22].
- **Rota alternativa encontrada (seção 17):** a **TikTok API for Business — Accounts API** (Organic API) tem publicação pública em conta própria (`/business/video/publish/`), status, webhooks e métricas profundas (`/business/video/list/` com retenção, tempo médio, alcance, origem de tráfego, audiência). Seu caso de uso autorizado é *"Manage the organic presence of brands or creators' owned accounts"*, e o guia de criação de app pede para declarar se o uso é *"limited only to internal organizational use"* (com exemplo de ferramenta *in-house*) ✅ [F26][F30]. Exige empresa (e-mail de domínio corporativo + site da empresa; não aceita desenvolvedor individual), revisão do app (2–3 dias úteis) e, desde 2026-03-20, o **Accounts API Access Application Form** 🔒 [F29][F30].

### Recomendação comparando as rotas

| Rota | Publica público? | Encaixa em "uso interno, contas próprias"? | Métricas | Esforço/risco | Veredito |
|---|---|---|---|---|---|
| **Content Posting — Direct Post** (developers.tiktok.com) | Só após auditoria; sem auditoria = `SELF_ONLY` | **Não**: guidelines rejeitam explicitamente ferramenta interna | Display API básica (views/likes/comments/shares) | Alto risco de reprovação | ❌ Descartar como rota principal |
| **Content Posting — Upload/inbox** | Humano finaliza no app | Também passa por App Review ("not for private or personal use") | Idem | Médio; 5 rascunhos pendentes/24h | ⚠️ Plano B fraco |
| **API for Business — Accounts API** | **Sim**, `/business/video/publish/` (público; ou rascunho via `upload_to_draft`) | **Sim**: feita para contas próprias de marca; uso interno é declarável | **Completas** (retenção, tempo médio, reach, tráfego, audiência; latência 24–48h) | Exige empresa registrada, aprovação + formulário de acesso; 15 posts/dia | ✅ **Rota recomendada** |
| **Manual assistido** (sistema prepara, humano posta no app/TikTok Studio) | Sim (pelo humano) | Sim, sem API de publicação | Pode combinar com Accounts API só para insights | Baixo risco; sem automação de post | ✅ **Fallback / MVP** enquanto a aprovação sai |

**Recomendação:** desenhar o conector TikTok sobre a **Accounts API (API for Business)** para publicar e coletar métricas, com o modo **manual assistido** como fallback desde o MVP (e caminho permanente se a aprovação for negada). Não investir na auditoria da Content Posting API. Pendências 🔒/❓: aprovação do formulário de acesso, elegibilidade de conta pessoal vs. Business/Advanced Access, e confirmar se o TikTok exige UX de consentimento equivalente às Content Sharing Guidelines nessa rota.

---

## 2. Pré-requisitos

| Item | Detalhe | Status | Fonte |
|---|---|---|---|
| Conta developer | Cadastro no portal TikTok for Developers por e-mail. | ✅ | [F13] |
| Dono do app | Recomendado criar/entrar numa **Organization**; app em conta individual é possível, mas desaconselhado para integrações reais. | ✅ | [F13] |
| Dados do app | Ícone 1024×1024 (JPEG/JPG/PNG, até 5 MB), nome, categoria, descrição (aparece na tela de autorização). Plataformas Web/Desktop exigem URL do site oficial. | ✅ | [F13] |
| Site público | App review exige site "official, fully developed, externally facing" (landing/login não servem), com links ativos para **Privacy Policy** e **Terms of Service**. | 🔒 | [F12] |
| Verificação de URLs | Apps criados após 2024-09-09 precisam verificar URLs de ToS, Privacy e Web/Desktop (por domínio via DNS ou por prefixo de URL via arquivo de assinatura). Apps que usam URL de upload da Content Posting API precisam verificar sempre. | ✅ | [F13] |
| Produtos | **Login Kit** (OAuth) + **Content Posting API** (habilitar a configuração **Direct Post** se for postar direto). Para métricas: escopo `video.list` (Display API). | ✅ | [F1][F13][F14] |
| Escopos | Adicionados na seção *Scopes* do app; escopos não usados atrasam a revisão. | ✅ | [F12][F13] |
| Demo em vídeo | 1 a 5 vídeos (até 50 MB cada) mostrando o fluxo ponta a ponta com UI real; apps nunca aprovados devem gravar no **Sandbox**; o domínio no vídeo deve bater com o site informado. | 🔒 | [F12][F13] |
| Tipos de conta TikTok (pessoal/creator/business) | **Nenhuma das páginas lidas** (Create an app, Login Kit overview, Content Posting get started) especifica quais tipos de conta TikTok são suportados pela Content Posting API. | ❓ | [F1][F13][F21] |
| Contas Business e música | Hipótese: contas Business têm biblioteca de música restrita (Commercial Music Library) — não confirmado em doc developer. | ❓ | — |

---

## 3. Autenticação (Login Kit / OAuth v2)

**Fluxo (web, server-side)** ✅ [F7][F8]
1. Redirecionar para `https://www.tiktok.com/v2/auth/authorize/` com `client_key`, `scope` (separados por vírgula), `redirect_uri`, `state` (anti-CSRF), `response_type=code`, opcional `disable_auto_auth` (0/1).
2. Callback recebe `code`, `scopes`, `state` (ou `error`, `error_description`).
3. Trocar o código: `POST https://open.tiktokapis.com/v2/oauth/token/` (`application/x-www-form-urlencoded`) com `client_key`, `client_secret`, `code` (URL-decoded), `grant_type=authorization_code`, `redirect_uri` (idêntico ao da autorização), e `code_verifier` (obrigatório apenas mobile/desktop).
4. Resposta: `access_token`, `expires_in`, `refresh_token`, `refresh_expires_in`, `open_id`, `scope`, `token_type=Bearer`.

**Regras de redirect URI (web)** ✅ [F7]: até 10 URIs, < 512 caracteres, absolutas e `https`, estáticas (sem query string), sem fragmento `#`.

**PKCE** ✅ [F20][F21]
- Login Kit Overview: *"PKCE applies to desktop, iOS, and Android but not web."* Web usa `state`.
- Desktop: `code_verifier` 43–128 caracteres `[A-Za-z0-9-._~]`, novo por requisição; `code_challenge` = SHA-256 do verifier **codificado em hex** (diferente do padrão RFC 7636 base64url); só `S256`. Redirect desktop: `localhost`/`127.0.0.1` com porta (wildcard `*` permitido).
- Como nosso painel será web com backend, **PKCE não é exigido**; o `client_secret` fica no servidor.

**Tokens** ✅ [F8][F9][F10]
| Item | Valor documentado | Observação |
|---|---|---|
| Access token | "2 hours" no texto | Exemplo de refresh mostra `expires_in: 86400` (24h) → **conflito na doc**; confiar no campo da resposta. |
| Refresh token | "180 days" no texto | Exemplo mostra `refresh_expires_in: 31536000` (365 dias) → **conflito**; confiar no campo da resposta. |
| Rotação | Cada refresh retorna **novo** `refresh_token` e invalida o anterior imediatamente. | Persistir atomicamente; concorrência entre jobs pode "queimar" o token → lock por conta. |
| Refresh | `POST /v2/oauth/token/` com `grant_type=refresh_token`, `refresh_token`, `client_key`, `client_secret`. Sem interação do usuário. | Job de background. |
| Revogação | `POST https://open.tiktokapis.com/v2/oauth/revoke/` com `client_key`, `client_secret`, `token`. Resposta vazia em sucesso. | Botão "desconectar conta". |
| Validade do `code` de autorização | Não informada nas páginas lidas. | ❓ |

**Escopos relevantes** ✅ [F14][F3]
| Escopo | Uso |
|---|---|
| `user.info.basic` | open_id, union_id, avatar_url, display_name (adicionado por padrão em apps com Login Kit). |
| `user.info.profile` | bio_description, profile_deep_link, is_verified, username. |
| `user.info.stats` | follower_count, following_count, likes_count, video_count. |
| `video.publish` | Direct Post + Get Post Status + creator_info. 🔒 |
| `video.upload` | Upload para inbox (rascunho) + Get Post Status. 🔒 |
| `video.list` | Ler vídeos **públicos** do usuário (List/Query Videos). |
| `video.manage` | "View, edit, and delete posts, including those made through other apps" — aparece na referência de escopos, mas não encontramos páginas de endpoint associadas. ❓ |

Todos os escopos dependem de aprovação do app ("approved for certain scopes") 🔒 [F3a].

---

## 4. Aprovação: App Review, Auditoria da Content Posting API e Sandbox

### 4.1 App Review (necessário para sair do sandbox) 🔒 [F12][F13]
- Estados: Draft → In review → Live / Not approved (com comentários; reenviar).
- Exigências: nome próprio (não descritivo, sem referência a redes sociais), site público completo com Privacy/ToS, redirect URI válido, explicação de cada produto/escopo, vídeo(s) de demo.
- *"Apps must not be for private or personal use."* e *"Apps still in development or testing will not be approved."*
- **Prazo:** não informado na doc oficial ❓.

### 4.2 Auditoria da Content Posting API 🔒
- Antes da auditoria (cliente "unaudited") ✅ [F2][F4]:
  - Todo conteúdo fica restrito a visualização privada (`SELF_ONLY`).
  - *"Unaudited API Clients can allow up to 5 users to post in a 24 hour window."*
  - *"All user accounts using the API client to post must be set to private at the time of posting."* (erro `unaudited_client_can_only_post_to_private_accounts` no init).
- Para remover a restrição: *"your API client must undergo an audit to verify compliance with our Terms of Service"* ✅ [F1][F4].
- Página do formulário de auditoria (`developers.tiktok.com/application/content-posting-api`) **não pôde ser lida** (HTTP 401 — requer login) → requisitos detalhados e prazo **não verificados** ❓ [F24].
- Casos de uso declarados como **inaceitáveis** nas guidelines ✅ [F4]:
  - *"An app that copies arbitrary contents from other platforms to TikTok."*
  - *"A utility tool to help upload contents to the account(s) you or your team manages."*
- Diretriz positiva: *"API Clients should facilitate authentic creators to post original content to TikTok."* ✅ [F4]
- Fontes de terceiros relatam que posts feitos antes da auditoria permanecem privados após aprovação — não confirmado em doc oficial ❓.

**Conclusão sobre um app interno de uma única conta/dono:** pela letra das diretrizes oficiais, **não deve passar na auditoria** (e possivelmente nem no App Review). Opções a avaliar:
1. **Modo Upload/inbox** (`video.upload`): o post final é feito pelo humano no app do TikTok, que escolhe a privacidade lá. Não depende da auditoria do Direct Post (a página de Upload não menciona auditoria) ✅ [F6], mas o app ainda precisa ser aprovado para `video.upload` no App Review, onde vale a regra "not for private or personal use" 🔒 [F12]. Limite: 5 rascunhos pendentes/24h.
2. **Unaudited + conta privada**: inútil para uma página pública.
3. **TikTok API for Business (Organic/Accounts API)**: possível rota para contas Business; documentação oficial não foi lida ❓ [F23].
4. **Publicação manual assistida**: nosso sistema prepara vídeo + legenda; humano publica no TikTok (ou TikTok Studio). Sem risco de compliance.

### 4.3 Sandbox ✅ [F11]
- *"restricted environment that allows you to try out integrations without having to submit your app for review."*
- Até **5 sandboxes** por app, até **10 contas-alvo** (target users).
- Sandbox **não inclui** Content Posting API para vídeos **públicos** (nem Data Portability). Se posts privados funcionam no sandbox: não especificado ❓.
- A configuração do sandbox pode ser importada para o rascunho de produção.

---

## 5. Publicação passo a passo

Host: `https://open.tiktokapis.com`. Headers: `Authorization: Bearer {access_token}`, `Content-Type: application/json; charset=UTF-8` ✅ [F2].

### 5.1 Query Creator Info — obrigatório (por UX/compliance) ✅ [F3][F4]
- `POST /v2/post/publish/creator_info/query/` (escopo `video.publish`), **20 req/min por token**.
- Retorna: `creator_avatar_url` (válida por 2h), `creator_username`, `creator_nickname`, `privacy_level_options`, `comment_disabled`, `duet_disabled`, `stitch_disabled`, `max_video_post_duration_sec`.
- `privacy_level_options`: contas públicas → `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `SELF_ONLY`; privadas → `FOLLOWER_OF_CREATOR`, `MUTUAL_FOLLOW_FRIENDS`, `SELF_ONLY`.
- Pode retornar (HTTP 200) `spam_risk_too_many_posts`, `spam_risk_user_banned_from_posting`, `reached_active_user_cap` → interromper publicação.
- Guidelines: buscar **a cada renderização** da tela de post.
- Não é tecnicamente um pré-requisito do `init` segundo a referência, mas o `privacy_level` enviado **deve** constar de `privacy_level_options` (senão `privacy_level_option_mismatch`) ✅ [F2].

### 5.2 Init

| | Direct Post | Upload (inbox/rascunho) |
|---|---|---|
| Endpoint | `POST /v2/post/publish/video/init/` | `POST /v2/post/publish/inbox/video/init/` |
| Escopo | `video.publish` 🔒 | `video.upload` 🔒 |
| `post_info` | Sim (abaixo) | Não documentado para vídeo (só `source_info`) |
| Rate limit | 6 req/min por token | 6 req/min por token |
| Resultado | Publica no perfil | Notificação no inbox; usuário finaliza no app |
| Fonte | ✅ [F2] | ✅ [F6] |

Resposta: `data.publish_id` (até 64 chars), `data.upload_url` (até 256 chars, só FILE_UPLOAD, **válida por 1 hora**), `error.code` (`ok` = sucesso), `error.message`, `error.logid` (exemplos usam `log_id` — inconsistência da doc) ✅ [F2].

**Campos `post_info` (Direct Post de vídeo)** ✅ [F2]
| Campo | Tipo | Obrig. | Nota |
|---|---|---|---|
| `privacy_level` | string | Sim | `PUBLIC_TO_EVERYONE` / `MUTUAL_FOLLOW_FRIENDS` / `FOLLOWER_OF_CREATOR` / `SELF_ONLY` |
| `title` | string | Não | Legenda; hashtags e menções reconhecidas; máx. **2200 UTF-16 runes** |
| `disable_duet` | bool | Não | |
| `disable_stitch` | bool | Não | |
| `disable_comment` | bool | Não | |
| `video_cover_timestamp_ms` | int32 | Não | Frame da capa; inválido/ausente = primeiro frame |
| `brand_content_toggle` | bool | Marcado como obrigatório na tabela | Paid partnership (terceiro) |
| `brand_organic_toggle` | bool | Não marcado | Promove o próprio negócio |
| `is_aigc` | bool | Não (default false) | Rotula como gerado por IA |

**`source_info`** ✅ [F2][F6]: `source` = `FILE_UPLOAD` | `PULL_FROM_URL`; `video_size` (bytes), `chunk_size`, `total_chunk_count` para FILE_UPLOAD; `video_url` para PULL_FROM_URL.

### 5.3 FILE_UPLOAD (chunks) ✅ [F2][F5a]
- `PUT {upload_url}` (com query params) com `Content-Type` (`video/mp4`, `video/quicktime`, `video/webm`), `Content-Length` (bytes do chunk), `Content-Range: bytes {FIRST}-{LAST}/{TOTAL}`.
- Chunk: **5 MB a 64 MB**; último chunk pode ter até **128 MB** (absorve o resto); arquivos < 5 MB = 1 chunk com `chunk_size` = tamanho total; > 64 MB obrigatoriamente em múltiplos chunks; **1 a 1000 chunks**; upload **sequencial**.
- `total_chunk_count` = floor(tamanho / chunk_size).

### 5.4 PULL_FROM_URL ✅ [F5a][F13]
- URL HTTPS, **sem redirect** (qualquer 3xx invalida), acessível durante todo o download; timeout de **1 hora**; banda de ingestão até 100 Mbps; cancelamento best-effort.
- Exige **propriedade verificada**: domínio (registro DNS; cobre subdomínios e todos os paths) ou prefixo de URL (https + host + path + `/`, host não pode ser IP). Erro: `url_ownership_unverified`.
- Implicação: se usarmos storage (S3/R2/GCS), precisa de domínio próprio verificado na frente (URLs pré-assinadas de domínio do provedor provavelmente não passam) ❓.

### 5.5 Status ✅ [F5]
- `POST /v2/post/publish/status/fetch/` com `{ "publish_id": "..." }`; escopo `video.upload` ou `video.publish`; **30 req/min por token**.
- `status`: `PROCESSING_UPLOAD`, `PROCESSING_DOWNLOAD`, `SEND_TO_USER_INBOX`, `PUBLISH_COMPLETE`, `FAILED`.
- `fail_reason`: `file_format_check_failed`, `duration_check_failed`, `frame_rate_check_failed`, `picture_size_check_failed`, `internal`, `video_pull_failed`, `photo_pull_failed`, `publish_cancelled`, `auth_removed`, `spam_risk_too_many_posts`, `spam_risk_user_banned_from_posting`, `spam_risk_text`, `spam_risk`.
- `publicaly_available_post_id` (lista int64; grafia original com erro) — só quando o post é público e passou na moderação. **É esse ID que liga ao `video.query` para métricas.**
- `uploaded_bytes` / `downloaded_bytes`.

### 5.6 Fotos (carrossel) ✅ [F19]
- `POST /v2/post/publish/content/init/`, `post_mode` = `DIRECT_POST` | `MEDIA_UPLOAD`, `media_type=PHOTO`, só `PULL_FROM_URL`, até **35** imagens, `photo_cover_index` obrigatório; `title` até 90 runes, `description` até 4000 runes; `auto_add_music`. `MEDIA_UPLOAD` requer app TikTok ≥ 31.8.

---

## 6. Requisitos de UX obrigatórios (afetam o painel de aprovação) ✅ [F4]

1. Buscar `creator_info` atualizado a cada abertura da tela de post; **exibir o nickname do criador** (conta de destino).
2. Se o criador não puder postar agora, parar e pedir para tentar depois.
3. Validar duração contra `max_video_post_duration_sec`.
4. Campo de **título editável** (todo texto pré-preenchido, inclusive legenda gerada por IA e hashtags, deve ser editável pelo usuário).
5. **Privacidade:** dropdown só com `privacy_level_options`, **sem valor default** (usuário escolhe manualmente).
6. **Comentário/Dueto/Stitch:** desmarcados por padrão; desabilitar (cinza) os que o criador bloqueou nas configurações. Fotos: só "Allow Comment".
7. **Divulgação de conteúdo comercial:** toggle desligado por padrão; ao ligar, opções "Your brand" (rótulo "Promotional content") e "Branded content" (rótulo "Paid partnership"); botão publicar desabilitado se nenhuma marcada, com tooltip *"You need to indicate if your content promotes yourself, a third party, or both."*; branded content não pode ser privado (desabilitar "Only me" com *"Branded content visibility cannot be set to private."*).
8. **Declaração de consentimento** antes do botão: *"By posting, you agree to TikTok's Music Usage Confirmation"* (com link); se branded content, link também para a Branded Content Policy.
9. **Preview** do conteúdo antes de postar.
10. **Não adicionar** marca d'água, logo, nome de marca, links ou texto promocional ao conteúdo.
11. **Não enviar mídia** ao TikTok antes do consentimento expresso do usuário.
12. Avisar que o processamento pode levar alguns minutos.
13. Mostrar status (polling ou webhooks).

**Implicação para a arquitetura:** a publicação deve ser disparada a partir de uma tela que cumpra estes requisitos *no momento do post*. Isso conflita com "aprovar agora e o sistema publica sozinho às 18h": a escolha de privacidade e o consentimento ficam registrados na aprovação, mas o `creator_info` precisa ser revalidado no momento do disparo ❓ (as guidelines não tratam explicitamente de agendamento).

---

## 7. Agendamento nativo via API

- **Não há** parâmetro de agendamento (ex.: `scheduled_publish_time`) nos campos documentados de Direct Post, Upload ou Photo Post; as Content Sharing Guidelines não mencionam agendamento ✅ (ausência nas páginas lidas) [F2][F4][F6][F19].
- Implicações: agendamento é responsabilidade nossa (fila com horário, worker que faz refresh do token, revalida `creator_info`, faz `init` e acompanha status). O `upload_url` expira em 1h, então o upload deve ocorrer no momento do disparo, não antecipadamente. No modo Upload/inbox, o "agendamento" só controla quando o rascunho chega; a publicação final é manual no app.
- Agendamento nativo existe no TikTok Studio/app — fora da API ❓.

---

## 8. Especificações de vídeo ✅ [F5a][F3]

| Item | Valor |
|---|---|
| Formatos | MP4 (recomendado), WebM, MOV |
| Codecs | H.264 (recomendado), H.265, VP8, VP9 |
| FPS | 23 a 60 |
| Resolução | 360 a 4096 px (altura e largura) |
| Duração | Criadores podem postar 3 min; alguns 5 ou 10 min; vídeos via endpoint de upload até 10 min. **Usar `max_video_post_duration_sec` do creator_info** como limite real por conta. |
| Duração mínima | Não informada nas páginas lidas ❓ |
| Tamanho máx. | 4 GB |
| Aspect ratio | Não especificado ❓ (9:16 é o natural para vertical, mas não há exigência documentada) |
| Imagens | WebP/JPEG, até 1080p, até 20 MB cada |

---

## 9. Metadados ✅ [F2][F19]

- Vídeo: `title` = legenda, até **2200 UTF-16 runes**; hashtags (`#`) e menções (`@`) no texto são reconhecidas.
- Não há campos separados para hashtags/menções; limites de quantidade de hashtags/menções não documentados ❓.
- Foto: `title` até 90 runes, `description` até 4000 runes.
- Atenção: na Display API, `title` e `video_description` aparecem com "max 150 characters" — inconsistência com os 2200 da publicação ❓ [F16].
- `spam_risk_text` em `fail_reason` indica que o texto da legenda pode ser bloqueado pelo Trust & Safety ✅ [F5].

---

## 10. Limites e cotas

| Limite | Valor | Status | Fonte |
|---|---|---|---|
| `creator_info/query` | 20 req/min por access token | ✅ | [F3] |
| `video/init` (Direct Post) | 6 req/min por access token | ✅ | [F2] |
| `inbox/video/init` (Upload) | 6 req/min por access token | ✅ | [F6] |
| `content/init` (foto) | 6 req/min por access token | ✅ | [F19] |
| `status/fetch` | 30 req/min por access token | ✅ | [F5] |
| `/v2/user/info/`, `/v2/video/list/`, `/v2/video/query/` | 600 req/min (janela deslizante), por endpoint | ✅ | [F18] |
| Posts por criador | "typically around 15 posts per day/ creator account", compartilhado entre todos os clientes Direct Post | ✅ | [F4] |
| Rascunhos pendentes (Upload) | máx. 5 em 24h (`spam_risk_too_many_pending_share`) | ✅ | [F6][F19] |
| Usuários (unaudited) | até 5 usuários postando em 24h | ✅ | [F4] |
| Cota diária de usuários ativos publicando no app | existe (`reached_active_user_cap`), valor não informado | ✅/❓ | [F2][F3] |
| Aumento de limites | via página de suporte, analisado caso a caso | ✅ | [F18] |

---

## 11. Métricas disponíveis via API oficial

### 11.1 Display API (TikTok for Developers) ✅ [F15][F16][F17]
- `POST /v2/video/list/` (escopo `video.list`): vídeos **públicos** do usuário, ordem `create_time` desc, `max_count` máx. 20, paginação por `cursor` (timestamp ms).
- `POST /v2/video/query/` (escopo `video.list`): até **20 `video_ids`** por requisição; valida que pertencem ao usuário; renova TTL da capa.
- Parâmetro `fields` na query string. Campos do Video Object: `id`, `create_time`, `cover_image_url` (expira em 6h), `share_url`, `video_description`, `duration`, `height`, `width`, `title`, `embed_html`, `embed_link`, **`like_count`** (int32), **`comment_count`** (int32), **`share_count`** (int32), **`view_count`** (int64), `is_aigc`.
- Conta: `GET /v2/user/info/` com `follower_count`, `following_count`, `likes_count`, `video_count` (escopo `user.info.stats`) ✅ [F3b].

**NÃO disponível na Display API** (ausente do Video Object) ✅: retenção/curva de audiência, tempo médio assistido, tempo total assistido, % de visualização completa, alcance/impressões, origem de tráfego (For You, perfil, busca), dados demográficos, saves/favoritos, novos seguidores por vídeo. Também **não retorna vídeos privados** (só "public video posts"), logo posts `SELF_ONLY` de cliente não auditado não aparecem ✅ [F15].

Observação: métricas são valores cumulativos atuais (snapshot); histórico precisa ser construído por nós com coletas periódicas ❓ (inferência).

### 11.2 TikTok API for Business (Organic API / Accounts API) ❓
- A central de ajuda de Ads confirma que o **Organic API** inclui Accounts, Mentions, TikTok One, Discovery e Spark Ads Recommendation APIs, com casos de uso de "content publishing, follower interaction, and account insights" ✅ [F23].
- Endpoints, métricas (ex.: `average_time_watched`), elegibilidade (contas Business/Creator?) e processo de acesso: a documentação do portal `business-api.tiktok.com` **não pôde ser lida** (renderização por JavaScript) → ❓. Fontes de terceiros citam `/open_api/v1.3/business/video/list/` e métricas de tempo médio com latência de 24–48h — **não confirmado**.
- Recomendação: pesquisa específica (com navegador logado) antes de decidir; pode ser a rota correta para métricas profundas **e** publicação para uma marca/página gamer.

---

## 12. Políticas relevantes

| Tema | Regra | Status | Fonte |
|---|---|---|---|
| Uso interno | Ferramenta para "account(s) you or your team manages" = inaceitável; apps não podem ser "for private or personal use" | ✅ | [F4][F12] |
| Conteúdo não original | "An app that copies arbitrary contents from other platforms to TikTok" = inaceitável; foco em "authentic creators to post original content" | ✅ | [F4] |
| Marcas d'água | Não adicionar marca d'água/logo/branding promocional ao conteúdo (guidelines e ToS III.3(t)) | ✅ | [F4][F22] |
| Música | Declaração obrigatória "Music Usage Confirmation" antes de postar | ✅ | [F4] |
| Conteúdo gerado por IA | Campo `is_aigc` rotula o post como gerado por IA | ✅ | [F2][F16] |
| Conteúdo comercial | `brand_content_toggle` / `brand_organic_toggle` + UX de divulgação | ✅ | [F2][F4] |
| ToS Developer — uso comercial | Proíbe uso comercial sem consentimento escrito, incluindo "facilitating any commercial advertisement or solicitation or spamming" (III.3(c)) | ✅ | [F22] |
| ToS — dados | Dados da API só para desenvolver/manter o app; deletar "in all forms" no término; proibido montar perfis/bases sobre indivíduos ou conteúdo (III.3(h)) | ✅ | [F22] |
| ToS — volume | Proibido uso excessivo e contornar limites (III.3(g),(m)); TikTok pode auditar e encerrar a qualquer momento | ✅ | [F22] |
| Legendas geradas por IA marcam o vídeo como AIGC? | O `is_aigc` refere-se ao **vídeo** gerado por IA; legenda de texto por IA não parece exigir o rótulo | ❓ | [F2] |
| Reaproveitar mesmo vídeo em várias plataformas | Não é "copiar conteúdo arbitrário de outras plataformas" se o vídeo é original nosso, mas a interpretação é do revisor | ❓ | [F4] |

---

## 13. Idempotência e erros comuns

- **Não existe chave de idempotência** documentada nos endpoints de init ✅ (ausência) [F2][F6]. Cada `init` gera um novo `publish_id`; reenviar após timeout pode **duplicar** o post.
- Estratégia recomendada (nossa, ❓): persistir o `publish_id` imediatamente após o `init`; em erro de rede no `init`, **não reenviar automaticamente** sem antes verificar (ex.: `video.list` recente / comparação de título); máquina de estados por publicação (`pending → initiated(publish_id) → uploading → processing → complete/failed`); lock por conta.
- Webhooks são "at least once" → deduplicar por (`publish_id`, `event`) ✅ [F5b].
- Erros do init (Direct Post) ✅ [F2]: `invalid_param` (400), `spam_risk_too_many_posts`, `spam_risk_user_banned_from_posting`, `reached_active_user_cap`, `unaudited_client_can_only_post_to_private_accounts`, `url_ownership_unverified`, `privacy_level_option_mismatch` (403), `access_token_invalid`, `scope_not_authorized` (401), `rate_limit_exceeded` (429), 5xx (retry).
- Upload: `spam_risk_too_many_pending_share` (403) ✅ [F6].
- Status: `invalid_publish_id`, `token_not_authorized_for_specified_publish_id` (400), `internal_error` (5xx) ✅ [F5].
- **Retry vs não retry** (pela doc de fail_reason) ✅ [F5]: retentável → `internal`, `video_pull_failed`/`photo_pull_failed` (se URL válida); **não retentar** → `auth_removed`, `spam_risk_user_banned_from_posting`, `spam_risk_text`, `spam_risk`; `spam_risk_too_many_posts` → postar pelo app.
- OAuth: erros no formato `error` / `error_description` / `log_id` (ex.: `invalid_request`) ✅ [F8][F9].
- Guardar sempre `logid`/`log_id` para suporte (o nome do campo varia entre exemplos da doc).

---

## 14. Webhooks ✅ [F5][F5b][F5c][F25]

- Configuração: callback URL HTTPS no portal; assinatura de todos os eventos por padrão; POST JSON; responder **200 imediatamente**; retries com backoff exponencial por até **72 h**, depois descartado; entrega **at least once**.
- Assinatura: header `TikTok-Signature: t=<timestamp>,s=<hex>`; HMAC-SHA256 com `client_secret` sobre `"{t}.{raw_body}"`; tolerância de timestamp a nosso critério.
- Payload comum: `client_key`, `event`, `create_time`, `user_openid`, `content` (JSON serializado como string).
- **Eventos de Content Posting** (seção "Content Posting webhooks" da página Get Post Status):
  | Evento | Campos em `content` |
  |---|---|
  | `post.publish.failed` | `publish_id`, `reason`, `publish_type` |
  | `post.publish.complete` | `publish_id`, `publish_type` |
  | `post.publish.inbox_delivered` | `publish_id`, `publish_type` |
  | `post.publish.publicly_available` | `publish_id`, `post_id`, `publish_type` |
  | `post.publish.no_longer_publicaly_available` | `publish_id`, `post_id`, `publish_type` (grafia original "publicaly") |
- `publish_type` = `INBOX_SHARE` para endpoints de upload (segundo snippet de busca da doc oficial; não reconfirmado na leitura direta) ❓.
- Outro evento útil: `authorization.removed` (`reason` 0–5: desconhecido, desconectado, conta deletada, idade mudou, banida, revogado pelo dev) → marcar conta como desconectada ✅ [F5c].
- A página "Webhook events" lista apenas eventos legados (`video.upload.failed`, `video.publish.completed`) + `authorization.removed` + `portability.download.ready`; o aviso de migração mapeia `video.upload.failed → post.publish.failed` e `video.publish.complete → post.publish.complete` ✅ [F5c][F25].
- Recomendação: usar webhook como gatilho e polling de `status/fetch` como reconciliação (fallback).

---

## 15. Tabela final

| Item | Status | Fonte |
|---|---|---|
| Uso interno/"contas que você ou seu time gerencia" é inaceitável para auditoria | ✅ | [F4] |
| Apps não podem ser para uso privado/pessoal (App Review) | ✅ 🔒 | [F12] |
| Unaudited: só `SELF_ONLY`, ≤5 usuários/24h, contas privadas | ✅ | [F2][F4] |
| Requisitos/prazo do formulário de auditoria | ❓ (página exige login) | [F24] |
| Prazo do App Review | ❓ | [F12] |
| Sandbox: 5 sandboxes, 10 contas, sem posts públicos | ✅ | [F11] |
| Authorize `https://www.tiktok.com/v2/auth/authorize/` | ✅ | [F7] |
| Token/refresh `POST /v2/oauth/token/`; revoke `POST /v2/oauth/revoke/` | ✅ | [F8][F9][F10] |
| Access token 2h / refresh 180d (exemplos conflitantes 86400/31536000) | ✅ (com conflito) | [F8][F9][F10] |
| Refresh token rotaciona a cada uso | ✅ | [F9] |
| PKCE só desktop/mobile, não web; challenge em hex | ✅ | [F20][F21] |
| Escopos `user.info.basic/profile/stats`, `video.publish`, `video.upload`, `video.list`, `video.manage` | ✅ (aprovação 🔒) | [F14] |
| Tipos de conta suportados (pessoal/creator/business) | ❓ | — |
| `creator_info/query` e campos | ✅ | [F3] |
| Direct Post `POST /v2/post/publish/video/init/` | ✅ 🔒 | [F2] |
| Upload `POST /v2/post/publish/inbox/video/init/` | ✅ 🔒 | [F6] |
| Campos `post_info` (privacy_level, title, disable_*, video_cover_timestamp_ms, brand_*_toggle, is_aigc) | ✅ | [F2] |
| Chunks 5–64 MB, último ≤128 MB, 1–1000, sequencial; `upload_url` 1h | ✅ | [F2][F5a] |
| PULL_FROM_URL exige domínio/prefixo verificado, sem redirect, timeout 1h | ✅ | [F5a] |
| Status `POST /v2/post/publish/status/fetch/`, status e fail_reasons | ✅ | [F5] |
| UX obrigatória (privacidade sem default, nickname, disclosure, consentimento, sem marca d'água) | ✅ | [F4] |
| Agendamento nativo via API | ✅ inexistente (ausência documental) | [F2][F4] |
| Vídeo: MP4/WebM/MOV, H.264/H.265/VP8/VP9, 23–60 fps, 360–4096 px, ≤4 GB, ≤10 min | ✅ | [F5a] |
| Duração mínima / aspect ratio exigido | ❓ | — |
| Legenda ≤2200 UTF-16 runes | ✅ | [F2] |
| Rate limits (6/20/30/600 por min) | ✅ | [F2][F3][F5][F18] |
| ~15 posts/dia por criador; 5 pendentes/24h no Upload | ✅ | [F4][F6] |
| Métricas: view/like/comment/share_count | ✅ | [F16][F17] |
| Sem retenção/tempo médio na Display API; só vídeos públicos | ✅ | [F15][F16] |
| Business/Organic API (métricas profundas e publicação) | ❓ (doc não legível) | [F23] |
| Sem chave de idempotência | ✅ (ausência) | [F2][F6] |
| Webhooks `post.publish.*`, assinatura HMAC, retries 72h, at-least-once | ✅ | [F5][F5b][F5d] |
| ToS: sem branding no conteúdo, sem uso comercial sem consentimento, deleção de dados | ✅ | [F22] |
| Business Accounts API: publicação pública em conta própria `/business/video/publish/` (só `video_url` verificada, sem privacidade, sem agendamento) | ✅ 🔒 | [F32] |
| Business: uso interno declarável; usos proibidos não incluem uso interno | ✅ | [F26][F30] |
| Business: exige empresa (e-mail corporativo + site); sem desenvolvedor individual | 🔒 | [F29] |
| Business: Accounts API Access Application Form (desde 2026-03-20) | 🔒 ❓ (form não lido) | [F26] |
| Business OAuth: auth_code 10 min; access 1 dia; refresh 1 ano; header `Access-Token` | ✅ | [F31][F34] |
| Business: 15 posts/dia, 6/min; 40 QPM por conta/endpoint; 600–1000 QPM por app | ✅ | [F32][F39] |
| Business: métricas com retenção, tempo médio, reach, origem de tráfego, audiência (T+24–48h) | ✅ | [F35] |
| Business: vídeo ≤1 GB, 3–600 s (conflito com "60 s" no webhook) | ✅ / ❓ | [F32][F37] |
| Business: publicar com conta pessoal (sem Advanced Access) | ❓ | [F26] |

---

## 16. Fontes

Todas acessadas em 2026-11-15. O site também serve as mesmas páginas sob `/docs/en/<slug>`.

- [F1] Content Posting API — Get Started (Direct Post): https://developers.tiktok.com/doc/content-posting-api-get-started
- [F2] Direct Post API Reference: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- [F3] Query Creator Info: https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info
- [F3a] Scopes Overview: https://developers.tiktok.com/doc/scopes-overview
- [F3b] Get User Info: https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info
- [F4] Content Sharing Guidelines: https://developers.tiktok.com/doc/content-sharing-guidelines (e https://developers.tiktok.com/docs/en/content-sharing-guidelines)
- [F5] Get Post Status + Content Posting webhooks: https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status (e https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status)
- [F5a] Media Transfer Guide: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
- [F5b] Webhooks Overview: https://developers.tiktok.com/doc/webhooks-overview
- [F5c] Webhook Events: https://developers.tiktok.com/doc/webhooks-events
- [F5d] Webhooks Verification: https://developers.tiktok.com/doc/webhooks-verification
- [F6] Upload Video API Reference: https://developers.tiktok.com/doc/content-posting-api-reference-upload-video ; Get Started — Upload: https://developers.tiktok.com/doc/content-posting-api-get-started-upload-content
- [F7] Login Kit for Web: https://developers.tiktok.com/doc/login-kit-web
- [F8] Get a User Access Token: https://developers.tiktok.com/docs/en/oauth-get-a-user-access-token ; Manage User Access Tokens: https://developers.tiktok.com/doc/oauth-user-access-token-management
- [F9] Refresh a User Access Token: https://developers.tiktok.com/docs/en/oauth-refresh-a-user-access-token
- [F10] Revoke a User Access Token: https://developers.tiktok.com/docs/en/oauth-revoke-a-user-access-token
- [F11] Add a Sandbox: https://developers.tiktok.com/doc/add-a-sandbox
- [F12] App Review Guidelines: https://developers.tiktok.com/doc/app-review-guidelines
- [F13] Create an App: https://developers.tiktok.com/docs/en/getting-started-create-an-app
- [F14] Scopes Reference: https://developers.tiktok.com/doc/tiktok-api-scopes
- [F15] List Videos: https://developers.tiktok.com/doc/tiktok-api-v2-video-list
- [F16] Video Object: https://developers.tiktok.com/doc/tiktok-api-v2-video-object
- [F17] Query Videos: https://developers.tiktok.com/doc/tiktok-api-v2-video-query
- [F18] Rate Limits: https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit
- [F19] Photo Post Reference: https://developers.tiktok.com/doc/content-posting-api-reference-photo-post
- [F20] Login Kit for Desktop: https://developers.tiktok.com/doc/login-kit-desktop
- [F21] Login Kit Overview: https://developers.tiktok.com/doc/login-kit-overview
- [F22] TikTok Developer Terms of Service: https://www.tiktok.com/legal/page/global/tik-tok-developer-terms-of-service/en
- [F23] About API for Business (TikTok Ads Help Center): https://ads.tiktok.com/help/article/marketing-api?lang=en — portal https://business-api.tiktok.com/portal/docs?id=1735713875563521 **não pôde ser lido** (conteúdo via JavaScript).
- [F24] Formulário de auditoria Content Posting API: https://developers.tiktok.com/application/content-posting-api — **não pôde ser lido** (HTTP 401, exige login).
- [F25] Migration Notice — Share Video API: https://developers.tiktok.com/bulletin/migration-notice-share-video-api/

Páginas tentadas sem sucesso: `https://developers.tiktok.com/doc/oauth-user-access-token-management-v2` (404), `https://developers.tiktok.com/doc/content-posting-api-webhooks` (404).

Fontes da seção 17 (TikTok API for Business v1.3), listadas abaixo como [F26]–[F40].

---

## 17. Rota alternativa: TikTok API for Business (Accounts/Organic) para contas próprias

> **Como foi lido:** o portal `business-api.tiktok.com/portal/docs/...` renderiza por JavaScript (WebFetch retorna só o título). O conteúdo foi obtido do **mesmo backend oficial que o portal usa** para renderizar as páginas: `https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=<chave v1.3>&doc_id=<id>&language=ENGLISH`. Os `doc_id`s batem com os links `portal/docs?id=<id>` citados. Por isso, o conteúdo abaixo é considerado ✅ (texto oficial), referenciado pela URL pública do portal.

### 17.1 O que é
- O Organic API tem cinco APIs: Accounts, Mentions, TikTok One, Discovery e Spark Ads Recommendation ✅ [F27].
- A Accounts API tem três serviços: **Accounts Insights**, **Accounts Moderation** (comentários) e **Accounts Video Publishing** ✅ [F26].
- **Usos autorizados:** *"Manage the organic presence of brands or creators' owned accounts on TikTok, including: Publishing video or photo posts. Moderating comments. Analyzing TikTok profile and post insights. Performing ad authorization for TikTok posts."* ✅ [F26]
- **Usos proibidos:** (1) usar relatórios agregados de criadores para montar programa próprio de influenciadores em vez do TikTok One; (2) *"Download TikTok videos and images, promote third-party solutions to save user data or media from TikTok, or migrate content to another TikTok account or other social media platforms."* ✅ [F26] → **não** baixar vídeos do TikTok para repostar em outras redes. O fluxo correto é original → versões por plataforma, nunca TikTok → outras.
- O TikTok pode revogar o acesso *"at any time without prior notice"* em caso de uso indevido ✅ [F26].

### 17.2 Requisitos

| Requisito | Detalhe | Status | Fonte |
|---|---|---|---|
| Conta TikTok for Business (portal developer) | Cadastro por e-mail/telefone no portal | ✅ | [F28] |
| Registro como developer | E-mail **de domínio corporativo** (pessoal/temporário é rejeitado); tipo Technology Company / Direct Advertiser / Agency; site da empresa público, completo, no domínio da empresa; *"Currently, we are unable to onboard personal accounts or individual developers."* Resultado em até 3 dias úteis | 🔒 | [F29] |
| App developer | Descrição com "Intended Uses" e **"Developer App Access Controls: Clarify whether the developer App access is limited only to internal organizational use, or shared with other external accounts"**. O exemplo oficial é *"our in-house ... tool"*. Revisão de **2 a 3 dias úteis**; até 5 apps por developer | ✅ 🔒 | [F30] |
| Permissão "TikTok Accounts" | Selecionar em *Scope of permission*; sem ela a "TikTok account holder authorization URL" não aparece | ✅ | [F31][F38] |
| **Accounts API Access Application Form** | Obrigatório desde **2026-03-20 00:00 GMT** antes de submeter um app novo ou pedir aumento de escopo com "TikTok Accounts". O formulário fica num domínio Lark (`bytedance.sg.larkoffice.com`) e **não foi lido** | 🔒 ❓ | [F26] |
| Logo do app | JPG/JPEG/PNG até 512×512 px; sem ele, o usuário vê página de erro na autorização | ✅ | [F31] |
| Tipo de conta TikTok | O glossário oficial define General/Personal Account, Account with Advanced Access (conta vinculada a TikTok for Business / Business Center) e Verified Business Account. **Não há** requisito explícito de tipo de conta para publicar. Algumas métricas exigem Advanced Access ou Verified Business | ✅ (glossário) / ❓ (elegibilidade para publicar com conta pessoal) | [F26][F35] |
| Analytics ligado no app | Para ter insights, o dono precisa ter publicado ≥1 vídeo e ativado "Turn On" em Analytics no app | ✅ | [F35] |
| URL verificada | `video_url` precisa ser de domínio/prefixo de URL **verificado** (obrigatório desde 2023-11-16); gestão via "Manage URL properties" e `/business/property/list/` | ✅ | [F32][F33] |

### 17.3 OAuth do produto Business ✅ [F31][F34]
1. O dono da conta TikTok abre a **TikTok account holder authorization URL** (gerada no portal; formato `https://www.tiktok.com/v2/auth/authorize?{parameters}`), opcionalmente com `&disable_auto_auth=1` e `state` (anti-CSRF).
2. Redirect URLs: até 10; absolutas, `https://`, **terminando em `/`**, sem query, sem `#`, **sem porta**, 10–512 caracteres; uma ativa por vez.
3. O callback recebe `auth_code`, válido por **10 minutos** e de **uso único**.
4. `POST https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/` (JSON) com `client_id`, `client_secret`, `grant_type=authorization_code`, `auth_code`, `redirect_uri`.
5. Resposta: `access_token` (**1 dia**; exemplo `expires_in: 86400`), `refresh_token` (**1 ano**; exemplo `refresh_token_expires_in: 31536000`), `open_id`, `scope`, `token_type=Bearer`.
6. Refresh: `POST /open_api/v1.3/tt_user/oauth2/refresh_token/` (`grant_type=refresh_token`). Revoke: `/tt_user/oauth2/revoke/`. Escopos concedidos: `GET /tt_user/token_info/get/`.
7. Chamadas usam o header **`Access-Token: <token>`** (não `Authorization: Bearer`) e `business_id` = `open_id`.
- Se o refresh token rotaciona a cada uso como na Content Posting API: **não informado** ❓.
- Ao expirar o refresh token (1 ano), o dono precisa reautorizar ✅ [F34].

**Escopos** (strings que aparecem nos exemplos oficiais de resposta) ✅ [F34][F38]: `user.info.basic`, `user.info.username`, `user.info.profile`, `user.info.stats`, `user.account.type`, `user.insights`, `video.list`, `video.insights`, `video.publish`, `video.upload`, `comment.list`, `comment.list.manage`, entre outros (`biz.*`, `message.*`, `tcm.*`). Mapeamento endpoint → permissão no portal ✅ [F40]:
- `/business/video/publish/`, `/business/video/settings/`, `/business/publish/status/`, `/business/hashtag/suggestion/` → *TikTok Accounts > Account Post Content > Video Publish*
- `/business/video/list/` → *Get Account Media*; `/business/get/` → *Account User*
- comentários → *Account Comment > Get/Manage Business Comment*

### 17.4 Publicação ✅ [F32][F36][F37]
- **Pré-consulta:** `GET /open_api/v1.3/business/video/settings/?business_id=` devolve `privacy_level_options`, `comment_disabled`, `duet_disabled`, `stitch_disabled`, `max_video_post_duration_sec` (exemplo: 600).
- **Publicar:** `POST https://business-api.tiktok.com/open_api/v1.3/business/video/publish/` (JSON).
  - `business_id` (obrigatório).
  - `video_url` (obrigatório): URL HTTP(S) pública, TTL mínimo recomendado de 30 min, **domínio/prefixo verificado**. **Não há upload de arquivo em chunks**, só pull de URL.
  - `custom_thumbnail_url` (opcional): JPG/JPEG/WebP/PNG ≤20 MB, de 360×360 até 1080×1920; quando presente, ignora `thumbnail_offset`.
  - `post_info` (obrigatório; `{}` se vazio):
    - `caption`: ≤ **2.200 caracteres UTF-16**, máx. **30 menções**; `\n` funciona só no app mobile; *"hashtags and mentions ... will render as plain text"*.
    - `is_brand_organic` (marcado obrigatório) → rótulo "Promotional content".
    - `is_branded_content` (marcado obrigatório) → "Paid partnership"; se os dois forem `true`, vale branded.
    - `disable_comment`, `disable_duet`, `disable_stitch`: default `false`, respeitando os `*_disabled` da conta.
    - `thumbnail_offset` (ms; default 0; maior que a duração faz a publicação falhar).
    - `is_ai_generated` (default `false`) → rótulo "Creator labeled as AI-generated", irreversível.
    - `upload_to_draft` (default `false`; se `true`, ignora os demais campos e manda para o inbox; exige escopo `video.upload`).
    - `location_id` / `location_name`, `is_ads_only`, `tto_invite_link`, `music_sound_info` (som comercial da Commercial Music Library via Discovery API, com volume/início/fim) e `video_original_sound_volume`.
  - **Não existe parâmetro de privacidade**: o endpoint publica um post **público**, e `privacy_level_options` aparece só na consulta de settings ✅ (ausência no schema) [F32].
  - **Não existe agendamento** (sem campo de horário) ✅ (ausência) [F32].
  - Resposta: `data.share_id` (ex.: `v_pub_url~v1....`), `request_id`, `code` (0 = OK). Header `X-Tt-Logid`.
- **Status:** `GET /open_api/v1.3/business/publish/status/?business_id=&publish_id=<share_id>`. Status possíveis: `PROCESSING_DOWNLOAD`, `PUBLISH_COMPLETE`, `FAILED` (com `reason`) e `SEND_TO_USER_INBOX`. `post_ids` vem quando completo e público, mas pode levar até 3 min (tentar de novo após 3 min). Esses IDs servem de filtro `video_ids` no `/business/video/list/` ✅ [F36].
- **Fotos:** `/business/photo/publish/` (permissão Photo Publish) ✅ [F40].
- **Hashtags sugeridas:** `/business/hashtag/suggestion/` ✅ [F40].

**Especificações de vídeo (Business)** ✅ [F32]: .mp4/.mov/.webm; **≤ 1 GB**; **3 s a 600 s** (limite real em `max_video_post_duration_sec`); altura e largura ≥ 360 px; 23–60 FPS. O texto de `duration_check_failed` nos webhooks diz "max 60 seconds long", o que **conflita** com os 600 s do endpoint ❓ [F37]. O vídeo é transcodificado e pode perder resolução/bitrate ✅ [F32].

### 17.5 Limites ✅
- Publicação: **6 vídeos/minuto** e **15/dia por conta TikTok** via endpoint ✅ [F32].
- Rate limit: **40 QPM por conta TikTok autorizada por endpoint**, mais um limite global do app para toda a Accounts API: Basic 600 QPM; Advanced, Premium e Ultimate 1.000 QPM ✅ [F39].
- Insights: dados de post param de atualizar **365 dias** após a publicação; latência **T+24–48h** na maioria das métricas ✅ [F35].
- O IP da chamada não afeta o alcance; não há restrição por IP ✅ [F38].

### 17.6 Métricas — Get post data (`GET /open_api/v1.3/business/video/list/`) ✅ [F35]
Parâmetros: `business_id`, `fields` (array; incluir sempre `item_id`), `filters.video_ids`, `filters.ad_post_only`, `cursor` (ms), `max_count` (padrão 10, máx. 20). Retorna posts **públicos** (vídeo, foto/texto e "Only show in ads"). Métricas são **lifetime** (sem limite de 60 dias).

| Campo | Permissão | Observação |
|---|---|---|
| `item_id`, `media_type`, `is_ad`, `thumbnail_url`, `share_url`, `embed_url`, `caption`, `create_time`, `is_ai_generated` | `video.list` | tempo real |
| `video_duration`, `likes`, `comments`, `shares` (inclui envios internos), `favorites`, `reach`, `video_views` (orgânico + pago) | `video.list` | T+24–48h |
| `total_time_watched`, **`average_time_watched`**, **`full_video_watched_rate`**, `new_followers` | `video.insights` | TikTok Studio |
| **`video_view_retention`** (por segundo: `second`, `percentage`) | `video.insights` | curva de retenção |
| **`impression_sources`** (For You, Follow, Sound, Personal Profile, Search, Direct Message, Others) | `video.insights` | origem de tráfego |
| `audience_genders`, `audience_countries` (top 10), `audience_cities` (top 10), `audience_types` (novos/recorrentes, seguidores/não seguidores), `engagement_likes` (por segundo) | `video.insights` | |
| `profile_views` | `video.insights` | só Advanced Access ou Verified Business |
| `website_clicks`, `phone_number_clicks`, `lead_submissions`, `app_download_clicks`, `email_clicks`, `address_clicks` | `video.insights` | só Verified Business |

Ressalvas oficiais: `reach`, `full_video_watched_rate`, `total_time_watched`, `average_time_watched`, `impression_sources` e `audience_countries` podem vir vazios se o vídeo ficou mais de 7 dias sem atividade; posts com violação (ex.: copyright de música) podem não aparecer; o dado só existe se também estiver no TikTok Analytics ✅ [F35].

**Perfil** (`GET /business/get/`): `followers_count`, `following_count`, `total_likes`, `videos_count`, `is_business_account`, `has_advanced_access`, métricas diárias (`video_views`, `unique_video_views`, `profile_views`, `likes`, `comments`, `shares`, `daily_new_followers`, `daily_lost_followers`, `daily_total_followers`, cliques), `audience_ages`, `audience_genders`, `audience_countries`, `audience_cities`, `audience_activity`, `engaged_audience`. Algumas exigem Advanced Access ou Verified Business ✅ [F41].

### 17.7 Webhooks (Business) ✅ [F37]
- Configuração via API: `/business/webhook/update/`, `/business/webhook/list/` (get) e delete.
- Eventos: `post.publish.failed` (`publish_id`, `reason`, `publish_type=DIRECT_PUBLISH`), `post.publish.complete`, `post.publish.publicly_available` (com `post_id`) e `post.publish.no_longer_publicly_available` (grafia correta aqui). Há também um evento de comentário.
- Tempo esperado: download de 1 GB em cerca de 30 min; `publicly_available` em até cerca de 2 min (mais se houver moderação manual).
- Retentáveis: `internal`, `video_pull_failed`/`photo_pull_failed` (se a URL for válida). **Não** retentáveis: formato, duração, FPS, resolução, `auth_removed`, `spam_risk*`.

### 17.8 Adequação ao uso interno
- ✅ **Adequada em princípio:** o produto é descrito para *"owned accounts"* de marcas/criadores; o guia de criação de app trata explicitamente o caso *"limited only to internal organizational use"* e dá como exemplo uma ferramenta *in-house*; os usos proibidos não incluem uso interno [F26][F30].
- 🔒 **Depende de aprovação:** registro de developer como **empresa** (exige e-mail corporativo e site da empresa; desenvolvedor individual não é aceito), revisão do app e Accounts API Access Application Form [F26][F29][F30].
- ⚠️ **Atenção a políticas:** é proibido migrar conteúdo do TikTok para outras plataformas [F26]; publicar o mesmo original em várias redes é o fluxo inverso, mas convém deixar isso claro na descrição do app ❓.
- ❓ Não encontramos, nesta rota, exigências de UX equivalentes às Content Sharing Guidelines (privacidade sem padrão, declaração de música). Mesmo assim, recomendamos manter no painel a declaração de conteúdo comercial e o toggle de IA, porque a API exige `is_brand_organic`/`is_branded_content`.
- ❓ Existe uma "TikTok Social MCP server" no índice da documentação (MCP Authorization). Não foi avaliada.

### 17.9 Fontes da seção 17
Todas acessadas em 2026-11-15 via backend oficial do portal (ver nota no início da seção).
- [F26] Accounts API — Overview: https://business-api.tiktok.com/portal/docs?id=1737944384433218 (índice do capítulo: https://business-api.tiktok.com/portal/docs?id=1737565048641538)
- [F27] Organic API: https://business-api.tiktok.com/portal/docs?id=1825101624331329
- [F28] Create a TikTok for Business account: https://business-api.tiktok.com/portal/docs?id=1738855099573250
- [F29] Register as a developer: https://business-api.tiktok.com/portal/docs?id=1738855176671234
- [F30] Create a developer app: https://business-api.tiktok.com/portal/docs?id=1738855242728450
- [F31] Accounts API — Authorization: https://business-api.tiktok.com/portal/docs?id=1738083939371009 ; Authorization (comparativo): https://business-api.tiktok.com/portal/docs?id=1781891256601602
- [F32] Publish a public video post to an owned account: https://business-api.tiktok.com/portal/docs/publish-a-public-video-post-to-an-owned-account/v1.3 (id=1762228496095234)
- [F33] Manage URL properties: https://business-api.tiktok.com/portal/docs?id=1769324038780930
- [F34] Accounts API — Authentication: https://business-api.tiktok.com/portal/docs?id=1738084387220481 ; Obtain a short-term access token: https://business-api.tiktok.com/portal/docs?id=1833997638479041
- [F35] Get post data of a TikTok account: https://business-api.tiktok.com/portal/docs/get-post-data-of-a-tiktok-account/v1.3 (id=1762228421622786)
- [F36] Get the publishing status of a TikTok post: https://business-api.tiktok.com/portal/docs?id=1816387106635778 ; Get the post privacy settings: https://business-api.tiktok.com/portal/docs?id=1816387951979521
- [F37] Post publishing events (webhooks): https://business-api.tiktok.com/portal/docs?id=1810515090228226
- [F38] Accounts API FAQs: https://business-api.tiktok.com/portal/docs?id=1776983576127490 ; token_info: https://business-api.tiktok.com/portal/docs?id=1765927978092545
- [F39] Accounts API — Rate limits: https://business-api.tiktok.com/portal/docs?id=1738084416214017
- [F40] List of available endpoints: https://business-api.tiktok.com/portal/docs?id=1735713875563521
- [F41] Get profile data of a TikTok account: https://business-api.tiktok.com/portal/docs?id=1762228399168514
- Não lido: Accounts API Access Application Form (`https://bytedance.sg.larkoffice.com/share/base/form/shrlgu4WEvtSXpEDLcCw56u4Rfc`) ❓.
