# Facebook (Páginas) — Análise da API oficial

> Pesquisado em 2026-11-15. Legenda: ✅ Confirmado · 🔒 Depende de aprovação · ❓ Hipótese a validar
>
> Versão da Graph API vista nas páginas de referência na data da pesquisa: **v27.0** ([ref. Page Video Reels](https://developers.facebook.com/docs/graph-api/reference/page/video_reels/)). As fontes estão numeradas como [F1], [F2]… e listadas na seção 16.
>
> Ressalva de método: todas as páginas foram lidas com WebFetch, que entrega o conteúdo resumido e não o HTML bruto. Os trechos citados devem ser conferidos de novo na doc antes da implementação. Quando uma página não trouxe uma informação, isso está dito no texto.

---

## 1. Resumo executivo

- ✅ Os Reels de Página são publicados pelo endpoint dedicado `POST /{page-id}/video_reels`, em 3 fases: `start` → upload binário em `rupload.facebook.com` → `finish` com `video_state` [F1][F2].
- ✅ **Há agendamento nativo para Reels**: `video_state=SCHEDULED` + `scheduled_publish_time` (Unix), entre **10 minutos e 29 dias** no futuro [F1].
- ✅ O upload aceita **arquivo local (binário)** ou **URL pública hospedada** (header `file_url`). A URL não pode exigir autenticação e o host precisa liberar o user agent `facebookexternalhit/1.1` no robots.txt [F1].
- ✅ Especificações de Reels: 9:16, mínimo 540x960 (recomendado 1080x1920), 24–60 fps, **3–90 s**, H.264/H.265, AAC 48 kHz, 128 kbps ou mais [F1].
- ✅ Limite de **30 Reels publicados via API por Página em 24 h móveis** [F1]. As chamadas com Page token ou System User token entram no BUC "Pages": `4800 * Engaged Users` por 24 h [F5].
- ✅ Permissões de publicação: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, com Page token de um usuário que tenha a tarefa `CREATE_CONTENT` [F1]. Para métricas: `read_insights` + `pages_manage_engagement` (ou `pages_read_engagement`, ver ambiguidade) e a tarefa `ANALYZE` [F3].
- ✅/🔒 **Para uso interno dá para operar sem App Review**: no modo Development, ou com Standard Access, um app pode pedir permissões a usuários que **têm papel no app** [F7][F8][F12]. Advanced Access, que serve para usuários sem papel, exige App Review e Business Verification [F7][F8].
- ✅ Para um backend sem usuário presente, o melhor caminho é um **System User do Business Manager**. O token pode ser não expirante, ou de 60 dias com refresh (que a Meta recomenda). Com esse token, `me/accounts` devolve os Page tokens [F9][F10][F11].
- ✅ A API traz o campo **`is_ai_generated`** (autodeclaração de IA) no `finish` dos Reels [F1][F2]. Para uma página de cortes gamer, o principal risco de política é a regra de **conteúdo não original**: reposts de material de terceiros sem transformação real perdem distribuição e monetização [F19][F20].
- ⚠️ Métricas: a Meta vem descontinuando impressões, alcance e "views de 3 s" desde 2025. Em **junho de 2026** estava prevista a remoção de `total_video_impressions*`, `total_video_views_*` e `post_impressions_unique*`. As substitutas são `*_media_view` e `*_total_media_view_unique` [F13][F14]. Não consegui confirmar se a remoção já aconteceu (❓).

---

## 2. Pré-requisitos

| Item | Detalhe | Status | Fonte |
|---|---|---|---|
| Página do Facebook | Os Reels só podem ser publicados em Páginas, e o crosspost também só vai para Páginas. | ✅ | [F1] |
| Tarefa do usuário na Página | Para publicar, o Page token precisa vir de um usuário que execute a tarefa `CREATE_CONTENT`. Para métricas de vídeo, a tarefa é `ANALYZE`. | ✅ | [F1], [F3] |
| Tarefas disponíveis | `CREATE_CONTENT`, `MANAGE`, `MODERATE`, `ADVERTISE`, `ANALYZE`, `MESSAGING`, `MANAGE_LEADS`, `VIEW_MONETIZATION_INSIGHTS`. Quem é Admin na UI executa todas. | ✅ | [F6] |
| Posts de feed (futuro) | O guia de Posts pede que o usuário tenha `CREATE_CONTENT`, `MANAGE` e `MODERATE`. Isso é mais restritivo que o guia de Reels. | ✅ (com divergência entre guias) | [F16] |
| App Meta do tipo Business | O Facebook Login for Business exige um app "business type" ou um app com caso de uso compatível. | ✅ | [F12] |
| Business Manager (portfólio empresarial) | É obrigatório para usar System User. O app precisa pertencer ao mesmo Business do System User, e um humano precisa ser admin do Business. | ✅ | [F9] |
| Business Verification | É exigida **somente** para Advanced Access. | ✅ | [F7], [F8] |
| Divulgação ao usuário | O guia de Reels pede que o app mostre ao usuário uma divulgação e opções de controle sobre como os Reels são usados no Facebook. Num uso interno, basta um aviso na UI. | ✅ (aplicação interna ❓) | [F1] |
| "New Pages Experience" | Para convidar colaboradores, usar o "delegate Page ID". Não encontrei outras notas sobre o assunto. | ✅ parcial | [F1] |
| Criação do app por "casos de uso" | O painel atual cria apps por *use cases*. Não confirmei o nome exato do caso de uso de Páginas. | ❓ | — |

---

## 3. Autenticação

### 3.1 Fluxo padrão (usuário humano)
1. ✅ O usuário faz **Facebook Login** (para negócios, a Meta prefere o *Facebook Login for Business* e chama-o de "the preferred authentication and authorization solution") e o app recebe um **User access token** [F6][F12].
2. ✅ O token curto é trocado por um **long-lived** com `GET oauth/access_token?grant_type=fb_exchange_token`. Ele dura **cerca de 60 dias** [F4].
3. ✅ Com o user token long-lived, `GET {app-scoped-user-id}/accounts` (ou `/me/accounts`) devolve o `access_token` de cada Página. **Um Page token obtido de um user token long-lived "não tem data de expiração"**, mas ainda pode ser invalidado em certas condições, como troca de senha, remoção de papel ou revogação [F4][F6].
4. ✅ Os Page tokens são únicos por Página, usuário e app. Se houver várias Páginas, guarde o ID e o token de cada uma separadamente [F6]. Isso afeta a arquitetura multi-página.

### 3.2 System User (Business Manager): recomendado para uso interno
- ✅ O System User é uma conta do Business Manager pensada para scripts e servidores. A Meta recomenda **System User regular**, não admin, para as chamadas, e um System User por necessidade de acesso [F9].
- ✅ Gerar o token: instalar o app no System User (`POST /{system-user-id}/applications`) e depois chamar `POST /{system-user-id}/access_tokens` com `business_app`, `scope`, `appsecret_proof` e, opcionalmente, `set_token_expires_in_60_days=true`. Também dá para fazer pela UI do Business Manager [F10].
- ✅ O token pode ser **não expirante** ou de **60 dias**. A Meta recomenda o de 60 dias, com refresh via `oauth/access_token` (`grant_type=fb_exchange_token` + `set_token_expires_in_60_days=true`) e rotação "refresh → deploy → revoke" [F10][F11].
- ✅ Os escopos aceitos por System User incluem `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic` e `business_management` [F10]. **Não vi `read_insights` nem `pages_manage_engagement` na lista resumida** (❓: confirmar na página completa).
- ✅ O System User token chama `me/accounts` e recebe as Páginas que gerencia, junto com o Page token de cada uma [F11].
- 🔒 Limites e pré-requisitos: com Standard Access ao "Ads Management Standard Access" o Business tem **1 System User + 1 admin System User**. Com Advanced Access, **10 + 1**. Para gerar o token, o app precisa de "Standard access" ao Marketing API [F9][F10]. ❓ Não está claro se um app que só usa Páginas atende a esse requisito sem passos extras. Validar no painel.
- ❓ A atribuição da Página ao System User, com as tarefas certas (CREATE_CONTENT e ANALYZE), é feita em Business Settings. A página que consultei não detalha o passo a passo.

**Recomendação (uso interno):** usar um **System User regular** no Business Manager do dono, atribuir a ele as Páginas com as tarefas de conteúdo e análise, e gerar um token **de 60 dias com rotação automática** guardado num cofre de segredos. Dele, derivar os Page tokens via `me/accounts`, por Página. Isso atende o cenário multi-página sem depender da sessão de um humano. Plano B: Page token long-lived obtido via login de um admin humano [F4]. É mais simples, mas fica preso ao vínculo desse humano com a Página.

### 3.3 Escopos (nomes atuais confirmados em [F17])

| Permissão | Para quê | Dependências |
|---|---|---|
| `pages_show_list` ✅ | Listar as Páginas gerenciadas | — |
| `pages_read_engagement` ✅ | Ler conteúdo, metadados e insights da Página | `pages_show_list` |
| `pages_manage_posts` ✅ | Criar, editar e apagar posts, fotos e vídeos | `pages_read_engagement`, `pages_show_list` |
| `read_insights` ✅ | Ler Insights de Páginas | `pages_read_engagement`, `pages_show_list` |
| `pages_manage_engagement` ✅ | Comentários e curtidas (exigida em video_insights e thumbnails) | `pages_read_user_content`, `pages_show_list` |
| `pages_read_user_content` ✅ | Conteúdo de usuários na Página (exigida em thumbnails) | `pages_show_list` |
| `pages_manage_metadata` ✅ | Assinar webhooks da Página | `pages_show_list` |
| `business_management` ✅ | API do Business Manager | `pages_read_engagement`, `pages_show_list` |
| `publish_video` ✅ | Segundo [F17], serve para **vídeos ao vivo** | — |

⚠️ **Ambiguidades:**
- O guia de Posts [F16] pede `publish_video` "para posts de vídeo" e cita `pages_read_user_engagement`, um nome que **não aparece** na referência de permissões [F17]. Provavelmente é erro e o nome certo é `pages_read_user_content` (❓).
- A referência de video_insights pede `pages_manage_engagement` + `read_insights`, mas o erro 283 cita `pages_read_engagement` [F3]. Testar.

---

## 4. Aprovação do app

| Ponto | Detalhe | Status | Fonte |
|---|---|---|---|
| Standard Access | Só pode ser pedida a usuários **com papel no app**. Apps Business recebem Standard Access automaticamente para as permissões do seu tipo. | ✅ | [F7] |
| Advanced Access | Pode ser pedida a qualquer usuário. Exige **Business Verification** e, por permissão, App Review. | 🔒 | [F7], [F8] |
| Modo Development | Pode pedir permissões (Standard ou Advanced) apenas a usuários com papel no app. Dados gerados nesse modo, como posts de teste, **só são visíveis para usuários com papel**. | ✅ | [F12b] |
| Modo Live | Só concede permissões aprovadas no App Review. | ✅ | [F12b] |
| Pages API | "All permissions require App Review before an app user can grant them to your app after it is live". Em apps Business, permissões para usuários sem papel exigem Advanced. | ✅ | [F6] |
| FB Login for Business | Advanced Access a `public_profile` é exigido antes de ir para Live com usuários sem papel. | 🔒 | [F12] |

**Implicação crítica para uso interno (❓ validar em teste real):** no modo Development, o conteúdo gerado "só é visível para usuários com papel" [F12b]. **Um Reel publicado com o app em modo Development pode não ficar público.** A doc não diz isso de forma explícita para Reels de Página. Opções:
- (a) colocar o app em **Live** usando só Standard Access, já que todos os operadores têm papel no app ou no Business. ❓ Confirmar se o painel deixa ir para Live sem App Review quando se usa apenas Standard Access.
- (b) passar pelo App Review e pela Business Verification.

**Esse é o primeiro teste a fazer na PoC.**

---

## 5. Publicação de Reels passo a passo

Fonte principal: [F1]. Referência do endpoint: [F2].

**Fase 1: start** ✅
```
POST https://graph.facebook.com/v27.0/{page-id}/video_reels
  upload_phase=start
  access_token={page-access-token}
→ { "video_id": "...", "upload_url": "https://rupload.facebook.com/video-upload/{video-id}" }
```

**Fase 2: upload (host `rupload.facebook.com`)** ✅
- Arquivo local: `POST /video-upload/{video-id}` com os headers `Authorization: OAuth {token}`, `offset: 0` e `file_size: {bytes}`, e o corpo binário em `application/octet-stream`.
- URL hospedada: o mesmo POST com o header `file_url: https://...`. Restrições:
  - o host precisa liberar o `facebookexternalhit/1.1` no robots.txt;
  - URLs do fbcdn são rejeitadas;
  - URLs que exigem autenticação não são suportadas.
  - ❓ Uma URL pré-assinada de S3/R2 provavelmente funciona por não exigir header de autenticação, mas ainda falta validar.
- Header opcional `place`: Página usada como localização.
- Resposta: `{"success": true}`.
- **Retomada:** quando o upload é interrompido, ler `uploading_phase.bytes_transfered` (grafia da Meta) via status e repetir o POST com esse `offset`. Se falhar de novo, recomeçar pela fase 1.

**Status** ✅: `GET /{video-id}?fields=status`
- Fases: `uploading_phase`, `processing_phase` e `publishing_phase` (esta com `publish_status` = `draft|error|published|scheduled` e `publish_time`).
- `video_status`: `error`, `expired`, `processing`, `ready`, `uploading`, `upload_failed`, `upload_complete`.
- Valores de status das fases: `not_started`, `in_progress`, `completed`, `error`. ⚠️ Os exemplos da doc também usam `complete`, então trate os dois.

**Fase 3: finish/publicação** ✅
```
POST https://graph.facebook.com/v27.0/{page-id}/video_reels
  upload_phase=finish
  video_id={video-id}
  video_state=PUBLISHED | DRAFT | SCHEDULED
  description="texto #hashtag"
  title="opcional"
  scheduled_publish_time={unix}      (só com SCHEDULED)
  is_ai_generated=true|false         (default false)
  place={place-id}
```
- ⚠️ Inconsistência na doc: o texto do passo 3 fala em `upload_phase=complete`, mas o enum é `start|finish` (na referência, `START|FINISH`) e os exemplos usam `finish` [F1][F2].
- A referência [F2] também lista parâmetros de **segmentação** (`targeting`, `geo_locations`, `age_min`, etc.), que não são úteis neste projeto.
- Retorno: [F2] lista `video_id`, `upload_url`, `success`, `message` e `post_id`. ❓ Não está claro se o `post_id` vem no finish; validar.

**Thumbnail / capa** ✅/❓
- O guia de Reels só remete à referência `POST /{video-id}/thumbnails`, com `source` (arquivo de imagem) e `is_preferred=true` [F1][F18].
- Regras: máximo de 10 MB e mesma proporção do vídeo recomendada. Permissões: `pages_read_user_content`, `pages_manage_engagement`, `pages_show_list` [F18].
- ❓ Falta testar em que momento chamar (antes ou depois do finish) e se a capa aparece de fato no Reel.

**Listar Reels da Página** ✅: `GET /{page-id}/video_reels`, com `since` e `until` [F1].

**Checagem de copyright** ✅: `GET /{video-id}?fields=copyright_check_information`, que indica `matches_found` e os trechos com match [F1]. **Vale rodar isso antes do agendamento ou da publicação.**

**Colaboradores** ✅: `POST /{video-id}/collaborators?target_id=...`, com limite de 10 convites por Página em 24 h [F1].

---

## 6. Agendamento nativo via API

| Tipo | Mecanismo | Janela | Status | Fonte |
|---|---|---|---|---|
| Reels | `video_state=SCHEDULED` + `scheduled_publish_time` (Unix) no `finish` | **> 10 min e ≤ 29 dias** | ✅ | [F1] |
| Posts de feed | `published=false` + `scheduled_publish_time` (Unix, ISO 8601 ou string do `strtotime`) | **10 min a 30 dias** | ✅ | [F16] |
| Vídeo normal (`/videos`) | A página consultada não trata de agendamento | — | ❓ | [F15] |

- ✅ A Meta recomenda que o app aplique **por conta própria** o limite de 30 Reels por 24 h, "especialmente para posts agendados" [F1]. Os agendados provavelmente contam no momento da chamada (❓).
- ❓ A doc não informa se dá para cancelar ou reagendar um Reel com status SCHEDULED pela API, nem como.
- **Arquitetura:** dá para usar o agendamento nativo quando o prazo for de até 29 dias, ou manter um agendador próprio que publica com `PUBLISHED` na hora certa. O agendador próprio dá controle uniforme entre plataformas e permite cancelar livremente. O nativo é mais resiliente se o nosso servidor cair.

---

## 7. Especificações de vídeo para Reels

Fonte: [F1], seção "Video Specifications" (✅ para todas as linhas).

| Propriedade | Requisito |
|---|---|
| Container | `.mp4` recomendado |
| Aspect ratio | 9:16. Os erros aceitam "entre 16:9 e 9:16" |
| Resolução | 1080x1920 recomendada, mínimo 540x960 |
| FPS | 24 a 60, fixo, progressivo |
| Duração | **3 a 90 s**. Até 60 s se publicado como Story da Página |
| Vídeo | Chroma 4:2:0, closed GOP de 2 a 5 s, H.264 ou H.265 (VP9 e AV1 também) |
| Áudio | AAC-LC, 128 kbps ou mais, estéreo, 48 kHz |
| Tamanho máximo do arquivo | **Não informado** no guia (❓) |

- Para vídeos normais, o guia de publicação [F15] não lista specs. ❓ Pesquisar na Central de Ajuda.
- **Pipeline:** gerar sempre uma saída H.264 + AAC 48 kHz, 1080x1920, 30 fps constante, GOP de 2 s e duração ≤ 90 s.

---

## 8. Metadados

| Item | Detalhe | Status | Fonte |
|---|---|---|---|
| `description` | String UTF-8, aceita emoji e hashtags | ✅ | [F1], [F2] |
| `title` | Opcional, UTF-8 | ✅ | [F1], [F2] |
| Limite de caracteres da descrição | **Não informado** nas páginas consultadas | ❓ | — |
| Limite de hashtags | **Não informado** | ❓ | — |
| Divulgação de IA | `is_ai_generated` (boolean) | ✅ | [F1], [F2] |
| Música | O guia só remete a guias de "music recommendations". Não há parâmetro de áudio no endpoint | ❓ | [F1], [F2] |
| Privacidade | Página = público implícito. A UI só deve oferecer "Public" | ✅ | [F1] |

---

## 9. Limites e cotas

| Limite | Valor | Status | Fonte |
|---|---|---|---|
| Reels via API por Página | **30 posts em 24 h móveis** em `POST /{page_id}/video_reels` | ✅ | [F1] |
| Convites de colaborador | 10 por Página em 24 h | ✅ | [F1] |
| BUC Pages (Page token ou System User token) | `Calls within 24 hours = 4800 * Number of Engaged Users` | ✅ | [F5] |
| Platform limit (app ou user token) | `Calls within one hour = 200 * Number of Users` | ✅ | [F5] |
| Headers de monitoramento | `X-App-Usage` e `X-Business-Use-Case-Usage`. `X-Page-Usage` não aparece na página atual | ✅ | [F5] |
| Erros de limite | `4` (app), `17` (user), `32` (Pages, com user ou app token), `613` (custom), `80001` (Pages BUC, com Page ou System User token) | ✅ | [F5] |
| Insights históricos | Dados disponíveis só dos **últimos 2 anos** | ✅ | [F3] |

- ❓ O BUC depende de "Engaged Users". Uma Página pequena tem cota menor, e por isso a coleta de métricas deve ser feita em lote e com intervalo razoável.

---

## 10. Métricas disponíveis

Endpoint: `GET /{video-id}/video_insights`. Permissões: `read_insights` + `pages_manage_engagement`, Page token com tarefa `ANALYZE` [F3].

**Métricas de Reels** (período `lifetime`) ✅ [F3]:
- `blue_reels_play_count`: plays com pelo menos 1 ms, sem replays.
- `fb_reels_replay_count`
- `fb_reels_total_plays`: inclui replays.
- `post_impressions_unique`: ⚠️ ver depreciação abaixo.
- `post_video_avg_time_watched`: em ms.
- `post_video_followers`
- `post_video_likes_by_reaction_type`
- `post_video_retention_graph`
- `post_video_social_actions`: comentários e compartilhamentos.
- `post_video_view_time`: em ms.

**Vídeos normais** ✅ [F3]: família `total_video_*`, por exemplo `total_video_views*`, `total_video_10s_views*`, `total_video_impressions*`, `total_video_avg_time_watched` e `total_video_retention_graph`.

**Depreciações** ✅ [F13][F14]:
- **15/06/2025:** saíram `post_impressions_unique*` (substituta: `post_total_media_view_unique`) e `page_impressions_unique*` (substituta: `page_total_media_view_unique`).
  - ⚠️ A referência de video_insights ainda lista `post_impressions_unique` para Reels, o que é uma contradição entre páginas.
  - ⚠️ O blog da v25 coloca a remoção de `post_impressions_unique*` e `page_impressions_unique*` em **junho de 2026**. As duas fontes discordam na data.
- **15/11/2025:** saíram `post_impressions*` → `post_media_view` e `page_impressions*` → `page_media_view`, com breakdowns `is_from_ads` e `is_from_followers`.
- **Junho de 2026 (anunciado na v25, 18/02/2026):**
  - remoção de `total_video_impressions*` (video_insights), de alcance de Post/Página e das métricas de "3-second viewers" (`page_video_views_unique`, `post_video_views_*`, `total_video_views_*`);
  - previsão de uma métrica nova, "Page Viewers".
- ❓ **Status atual (nov/2026) não confirmado.** Antes de definir o modelo de dados de métricas, conferir o changelog da Graph API ([F21]). A recomendação é basear o modelo em `blue_reels_play_count`, `fb_reels_total_plays`, `post_video_view_time`, `post_video_avg_time_watched`, `post_video_social_actions`, `post_video_followers` e `post_total_media_view_unique` / `post_media_view`.

**Latência:** a referência **não informa** a latência das métricas (❓). Fazer polling escalonado, por exemplo em +1 h, +24 h, +72 h e +7 d.

**Crosspost:** cada Página recebe um video ID próprio [F3], então as métricas são coletadas por ID e por Página.

---

## 11. Políticas relevantes

| Tema | Detalhe | Status | Fonte |
|---|---|---|---|
| Conteúdo não original | Desde 14/07/2025, contas que reutilizam vídeos de outros sem permissão ou mudança significativa perdem acesso à monetização e têm a distribuição reduzida. Duplicatas são rebaixadas. Juntar clipes ou só pôr marca d'água **não** conta como mudança significativa. | ✅ | [F19] |
| Originalidade (mar/2026) | São rebaixados: re-upload de posts em que a conta não teve papel, "watch along", reação sem acréscimo, costura de clipes e narração do que já está na tela. Bordas, legendas e mudança de velocidade são consideradas edições de baixo valor. Contas reincidentes podem virar "non-recommendable and demonetized". | ✅ | [F20] |
| Marcas d'água de outros apps | O blog de criadores recomenda evitar marcas d'água visíveis de terceiros, como a de outro app. | ✅ | [F19] |
| Copyright | Há checagem automática no upload, com resultado por API. Violações podem restringir o acesso ou a monetização. | ✅ | [F1] |
| Rotulagem de IA | Selo "AI info" por detecção ou autodeclaração. A API de Reels tem `is_ai_generated`. | ✅ | [F1], [F22] |
| Rotulagem de IA (obrigatoriedade) | A política de rotulagem obrigatória para vídeo fotorrealista ou áudio realista e as penalidades **não foram confirmadas** numa página oficial lida por completo (a Central de Ajuda não carregou) | ❓ | [F22] |
| Música | O endpoint não tem parâmetro de áudio licenciado. Música de terceiros no arquivo passa pela checagem de copyright. | ❓ | [F1], [F2] |
| Monetização de Reels | As regras do programa de monetização não foram pesquisadas a fundo. O que se sabe é que não originalidade leva à perda de monetização. | ❓ / ✅ parcial | [F19], [F20] |

**Implicação para a página gamer:** legendas geradas por IA **não** tornam original um gameplay de terceiros. O conteúdo de origem precisa ser da própria página (gameplay próprio, comentário próprio). Recomendo marcar `is_ai_generated` com uma regra explícita na aprovação humana, porque **a legenda por IA não é necessariamente "conteúdo gerado por IA"**. ❓ Definir o critério com o dono.

---

## 12. Idempotência e erros comuns

**Idempotência (não há chave de idempotência documentada, ❓)**
- ✅ Gravar o `video_id` devolvido pelo `start` **antes** do upload, e só chamar o `finish` depois de checar `GET /{video-id}?fields=status`. Se `publishing_phase.publish_status` já for `published` ou `scheduled`, não repetir [F1].
- ✅ Para reconciliar, `GET /{page-id}/video_reels?since=...&until=...` lista os Reels da Página [F1].
- ❓ Não há garantia documentada de que um `finish` repetido não gera duplicata. Tratar timeouts do `finish` com consulta de status, nunca com retry cego.
- ✅ Um post só pode ser atualizado pelo app que o criou [F16].

**Códigos de erro** ✅ [F1][F2][F5]

| Código | Significado |
|---|---|
| 100 | Parâmetro faltando ou inválido |
| 104 | Assinatura incorreta |
| 190 | Token OAuth inválido. Renovar ou reemitir |
| 200 | Erro de permissão |
| 283 | Falta de permissão de insights (cita `pages_read_engagement`) [F3] |
| 368 | Ação considerada abusiva |
| 613 | Rate limit |
| 4 / 17 / 32 / 80001 | Limites de app, usuário, Pages e Pages BUC |
| 6000 | Problema no upload. Tentar outro arquivo |
| 1363040 | Aspect ratio não suportado |
| 1363127 | Resolução não suportada |
| 1363128 | Duração não suportada (3–90 s) |
| 1363129 | FPS não suportado (24–60) |
| `OffsetInvalidError` / `PartialRequestError` / `ProcessingFailedError` | Erros de upload no rupload |

---

## 13. Webhooks úteis

Fonte: [F23] (✅).

- `videos`: mudanças no status de encoding do vídeo, com `id`, `status` e `video_status`. É o mais útil para saber quando o processamento terminou. ❓ A página não cita Reels explicitamente; validar se dispara para `video_reels`.
- `feed`: mudanças no feed da Página, como posts e comentários.
- `mention`: menções à Página.
- `live_videos`: lives (fora do escopo).
- **Requisito:** um admin com privilégio MODERATE precisa conceder `pages_manage_metadata`. Depois, assinar a Página no app.
- Recomendação: tratar webhooks como **aceleradores**, não como garantia. O polling de status continua sendo a fonte de verdade.

---

## 14. Relação com Instagram

- ✅ A publicação no Instagram tem dois caminhos [F24]:
  - **Instagram Login** (`graph.instagram.com`, com `instagram_business_basic` e `instagram_business_content_publish`);
  - **Facebook Login for Business** (`graph.facebook.com` + `rupload.facebook.com`, com `instagram_basic`, `instagram_content_publish` e `pages_read_engagement`). Esse caminho usa **Page access token** e também tem um modo "Unified Login" com **Business Integration System User token**.
- ✅ Os escopos `instagram_basic` e `pages_*` estão na lista de escopos aceitos por System User [F10].
- ✅ Limite do Instagram: 100 posts via API em 24 h. ⚠️ A seção de carrossel da mesma doc diz 50, o que é contraditório [F24].
- ❓ A doc não diz explicitamente "use o mesmo app". Mas o caminho via Facebook Login for Business usa o mesmo tipo de app (Business), os mesmos hosts e o mesmo Page token. **Isso é forte indício de que um único app Meta e um único System User atendem FB e IG**, desde que a conta IG profissional esteja vinculada à Página.

**Recomendação:** **um único app Meta (tipo Business)** no Business Manager do dono e **um System User** com as Páginas e as contas IG atribuídas. Usar o caminho Facebook Login for Business / Graph API para os dois. Assim há um só cofre de tokens, um só App Review (se for preciso) e um mesmo BUC. Validar na PoC:
- se `instagram_content_publish` pode ser concedido ao System User;
- se é preciso "Page Publishing Authorization" [F24].

---

## 15. Tabela final

| Item | Status | Fonte |
|---|---|---|
| Endpoint `POST /{page-id}/video_reels` (start/finish) | ✅ | [F1], [F2] |
| Upload em `rupload.facebook.com` (binário ou `file_url`) | ✅ | [F1] |
| Retomada de upload por `offset` | ✅ | [F1] |
| Status via `?fields=status` | ✅ | [F1] |
| `video_state` DRAFT/PUBLISHED/SCHEDULED | ✅ | [F1], [F2] |
| Agendamento de Reels: 10 min a 29 dias | ✅ | [F1] |
| Agendamento de posts de feed: 10 min a 30 dias | ✅ | [F16] |
| Cancelar ou reagendar Reel agendado via API | ❓ | — |
| `is_ai_generated` | ✅ | [F1], [F2] |
| Capa via `POST /{video-id}/thumbnails` (efeito em Reels) | ✅ endpoint / ❓ efeito | [F18] |
| Specs: 9:16, 540x960 mín., 24–60 fps, 3–90 s, H.264/H.265, AAC 48 kHz | ✅ | [F1] |
| Tamanho máximo do arquivo de Reel | ❓ | — |
| Limite de caracteres e hashtags na descrição | ❓ | — |
| 30 Reels via API por Página em 24 h | ✅ | [F1] |
| BUC Pages = 4800 × engaged users / 24 h | ✅ | [F5] |
| Permissões `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` | ✅ (🔒 Advanced para quem não tem papel) | [F1], [F17] |
| Insights: `read_insights` + `pages_manage_engagement`, tarefa ANALYZE | ✅ | [F3] |
| Page token long-lived sem expiração | ✅ | [F4] |
| System User token (não expirante ou 60 d) + `me/accounts` | ✅ | [F10], [F11] |
| System User exige Standard Access ao Marketing API | ✅ / ❓ aplicação prática | [F9], [F10] |
| Standard Access só para usuários com papel, sem App Review | ✅ | [F7] |
| Advanced Access exige Business Verification + App Review | 🔒 | [F7], [F8] |
| Reel publicado em modo Development fica público? | ❓ (risco) | [F12b] |
| Métricas de Reels (`blue_reels_play_count` etc.) | ✅ | [F3] |
| Remoção de impressões e views de 3 s em jun/2026 efetivada | ❓ | [F13], [F14] |
| Latência das métricas | ❓ | — |
| Webhook `videos` para status de encoding | ✅ (❓ para Reels) | [F23] |
| Checagem de copyright via API | ✅ | [F1] |
| Política de conteúdo não original | ✅ | [F19], [F20] |
| Rotulagem de IA obrigatória e penalidades | ❓ | [F22] |
| Mesmo app e System User para FB + IG | ❓ (forte indício) | [F10], [F24] |
| Vídeo normal via `/{page-id}/videos` + Resumable Upload API | ✅ | [F15] |

---

## 16. Fontes

- [F1] Reels Publishing API: https://developers.facebook.com/docs/video-api/guides/reels-publishing (também em https://developers.facebook.com/documentation/video-api/guides/reels-publishing.md)
- [F2] Graph API Reference v27.0, Page Video Reels: https://developers.facebook.com/docs/graph-api/reference/page/video_reels/
- [F3] Video Insights (video_insights): https://developers.facebook.com/docs/graph-api/reference/video/video_insights/
- [F4] Long-lived access tokens: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/
- [F5] Rate Limiting: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
- [F6] Pages API Overview: https://developers.facebook.com/docs/pages-api/overview
- [F7] Access Levels: https://developers.facebook.com/docs/graph-api/overview/access-levels/
- [F8] Permissions Reference (Business Verification para Advanced): https://developers.facebook.com/docs/permissions
- [F9] System Users Overview: https://developers.facebook.com/docs/marketing-api/system-users/overview
- [F10] Install Apps, Generate, Refresh, and Revoke Tokens (System Users): https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens
- [F11] Access Token Guide (Page tokens / me/accounts com System User): https://developers.facebook.com/docs/pages/access-tokens/ e https://developers.facebook.com/documentation/facebook-login/guides/access-tokens (conteúdo obtido pelo resumo da busca, sem leitura integral; tratar como ✅ com cautela)
- [F12] Facebook Login for Business: https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
- [F12b] App Modes (Development/Live): https://developers.facebook.com/docs/development/build-and-test/app-modes
- [F13] Deprecated Facebook Page Insights Metrics: https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics
- [F14] Introducing Graph API v25.0 (18/02/2026): https://developers.facebook.com/blog/post/2026/02/18/introducing-graph-api-v25-and-marketing-api-v25/ (ver também https://developers.facebook.com/blog/post/2025/08/15/page-insights-api-updates/)
- [F15] Video API, Publishing (vídeos normais): https://developers.facebook.com/docs/video-api/guides/publishing
- [F16] Pages API, Posts: https://developers.facebook.com/docs/pages-api/posts
- [F17] Permissions Reference: https://developers.facebook.com/docs/permissions
- [F18] Video Thumbnails: https://developers.facebook.com/docs/graph-api/reference/video/thumbnails
- [F19] Combating unoriginal content (Meta for Creators, 14/07/2025): https://creators.facebook.com/blog/combating-unoriginal-content
- [F20] Rewarding Original Creators on Facebook (Meta Newsroom, mar/2026): https://about.fb.com/news/2026/03/rewarding-original-creators-on-facebook/
- [F21] Graph API Changelog (consultar o status atual das depreciações): https://developers.facebook.com/docs/graph-api/changelog/ e https://developers.facebook.com/documentation/pages-api/changelog (**não lidos**)
- [F22] Labeling AI-Generated Content (Meta Newsroom, atualizado em 23/10/2025): https://about.fb.com/news/2024/04/metas-approach-to-labeling-ai-generated-content-and-manipulated-media/. A Central de Ajuda https://www.meta.com/en-gb/help/artificial-intelligence/1783222608822690/ **não pôde ser lida** (conteúdo truncado).
- [F23] Webhooks, Page reference: https://developers.facebook.com/docs/graph-api/webhooks/reference/page/
- [F24] Instagram Platform, Content Publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing/

**Páginas que não puderam ser lidas:**
- https://developers.facebook.com/docs/video-api/guides/reels-publishing/custom-cover (404);
- a Central de Ajuda de IA da Meta (truncada);
- os changelogs (não consultados).
