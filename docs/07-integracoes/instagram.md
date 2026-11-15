# Instagram — Análise da API oficial

> Pesquisado em 2026-11-15. Legenda: ✅ Confirmado · 🔒 Depende de aprovação · ❓ Hipótese a validar

**Observação sobre as fontes:** a Meta migrou a documentação de `developers.facebook.com/docs/...` para `developers.facebook.com/documentation/...` (as duas URLs ainda respondem; há versões `.md` de cada página). As páginas foram lidas por WebFetch em 2026-11-15. A versão de API citada nos exemplos oficiais é a **v27.0**. Quando a doc se contradiz, isso está marcado como ⚠️ e o item fica ❓.

**Páginas que não puderam ser lidas** (pontos relacionados ficam como ❓):
- `https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/upload-media.md` (retornou "Página não encontrada").
- `https://help.instagram.com/761121959519495` (rotulagem de IA, só o título carregou).
- `https://www.meta.com/help/artificial-intelligence/1783222608822690/` (rotulagem de IA, conteúdo truncado).

---

## 1. Resumo executivo

- ✅ **Agora há TRÊS variantes oficiais, não duas.** Além de "Instagram API with Instagram Login" e "Instagram API with Facebook Login", a Meta documenta a **"Instagram API with Unified Login"**, que descreve como "recommended for new integrations". A doc diz ainda: "New Instagram API features are released only for this setup". As outras duas são apresentadas como opções para integrações existentes. [overview](https://developers.facebook.com/documentation/instagram-platform/overview.md) · [unified login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login.md)
- ✅ **Recomendação para o nosso caso: Unified Login**, com o app sendo de uma *business portfolio* (Business Manager) do dono. O token pertence ao portfólio e não a uma pessoa, não exige Página do Facebook e dá acesso a upload resumable, Audio API e delete. Isso combina com "várias páginas do mesmo dono". O plano B é Facebook Login, e o plano C é Instagram Login (detalhes na seção 3). ❓ A Unified Login é recente e a doc ainda tem lacunas (expiração do token, por exemplo), então é preciso validar com uma prova de conceito.
- ✅ **Uso interno dispensa App Review.** Um app que só atende um negócio próprio usa Standard Access, e o App Review "Not required". Isso vale para contas cujos usuários têm papel no app ou no negócio. [app review](https://developers.facebook.com/documentation/instagram-platform/app-review.md) · [access levels](https://developers.facebook.com/documentation/development/graph-api/overview/access-levels)
- ✅ **A publicação é sempre em duas etapas e assíncrona:** `POST /<IG_ID>/media` cria um container, depois é preciso consultar `status_code` até `FINISHED`, e só então `POST /<IG_ID>/media_publish`. O container expira em 24h. [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md)
- ✅ **Não existe agendamento nativo via API.** Nenhum parâmetro do tipo `scheduled_publish_time` existe para Instagram, então precisamos de um agendador próprio (seção 6).
- ⚠️ **O limite de publicação diária é contraditório na doc: 50 ou 100 posts por 24h.** As referências de `media_publish` e `content_publishing_limit` dizem 50. A seção "Rate Limit" do guia diz 100. Devemos usar `GET /<IG_ID>/content_publishing_limit` como fonte de verdade em runtime. Para uma página gamer, isso não deve restringir o uso.
- ✅ **O vídeo precisa estar numa URL pública, ou ser enviado por upload resumable.** O upload resumable via `rupload.facebook.com` só está documentado para Facebook Login for Business (Facebook Login e Unified Login). Com Instagram Login, só aparece o envio por URL pública.
- ✅ **Especificação de Reels:** MP4/MOV, H.264/HEVC, 23–60 fps, largura máxima de 1920 px, 9:16 recomendado, 3 s a 15 min, até 300 MB, AAC até 48 kHz.
- ✅ **Métricas de Reels hoje:** `views`, `reach`, `likes`, `comments`, `shares`, `saved`, `total_interactions`, `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate`, `reposts`, `facebook_views`, `crossposted_views`. As métricas `plays`, `impressions`, `video_views`, `clips_replays_count` e `ig_reels_aggregated_all_plays_count` foram depreciadas. Os dados podem atrasar até 48h e ficam guardados por até 2 anos.
- ✅ **Risco de política: conteúdo não original.** Desde 2024 nos Reels, e desde 30/04/2026 também em fotos e carrosséis, contas que postam principalmente conteúdo de terceiros perdem elegibilidade a recomendações. Marca d'água, borda ou crédito na legenda não bastam para tornar o conteúdo original. A pipeline deve trabalhar só com vídeo original e evitar marcas d'água de outras plataformas (por exemplo, o logo do TikTok). [creators.instagram.com](https://creators.instagram.com/blog/rewarding-original-creators-on-instagram)

---

## 2. Pré-requisitos de conta

| Requisito | Unified Login | Instagram Login | Facebook Login | Status | Fonte |
|---|---|---|---|---|---|
| Conta Instagram profissional (Business ou Creator) | Sim. Conta pessoal gera o erro `(#10) Access is denied because the instagram account type is not business or creator.` | Sim ("Instagram professional accounts") | Sim ("Instagram Business Account or Instagram Creator Account") | ✅ | [eligibility](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/eligibility-and-troubleshooting.md), [overview](https://developers.facebook.com/documentation/instagram-platform/overview.md), [FB get started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started.md) |
| Página do Facebook vinculada | **Não** exige | **Não** exige | **Exige**, e o usuário precisa poder executar tarefas na Página (`MANAGE` ou `CREATE_CONTENT` para publicar) | ✅ | [overview](https://developers.facebook.com/documentation/instagram-platform/overview.md), [ig-user/media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md) |
| Business portfolio (Business Manager) | **Exige.** O app precisa ser de um portfólio, e o cliente escolhe o portfólio no login. | Não exigido pelo fluxo | Depende da configuração do Facebook Login for Business | ✅ | [unified login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login.md), [eligibility](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/eligibility-and-troubleshooting.md) |
| Page Publishing Authorization (PPA) | — | — | Se a Página exigir PPA, a publicação falha até que ela seja concluída. Se a Página exigir 2FA, o usuário também precisa ter 2FA. | ✅ | [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md), [media_publish](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish.md) |
| App Meta registrado | App de negócio, de um portfólio (Unified) | App com o produto Instagram (Business Login for Instagram) | App com "Basic settings" e o produto Facebook Login for Business | ✅ | mesmas fontes |
| Conta de Creator funciona igual a Business para publicação | A doc trata as duas como elegíveis | | | ❓ Pode haver diferenças em recursos específicos, como branded content. Validar na PoC. | [eligibility](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/eligibility-and-troubleshooting.md) |

**Para o nosso caso:** usar conta **Business**, já vinculada a um business portfolio do dono, com o app de automação pertencendo ao mesmo portfólio. Cada nova página gamer do mesmo dono vira mais um ativo Instagram nesse portfólio. ❓ A estratégia de "uma configuração de login, vários ativos" precisa ser validada.

---

## 3. Autenticação e autorização

### 3.1 Comparativo das três variantes

| | Unified Login | Instagram Login | Facebook Login |
|---|---|---|---|
| Login do usuário | Instagram **ou** Facebook | Instagram | Facebook |
| Host da API | `graph.facebook.com` | `graph.instagram.com` | `graph.facebook.com` |
| Token | Business Integration System User Access Token (SUAT) | Instagram User access token | Facebook User ou Page access token |
| Objeto principal | ID da conta profissional IG | ID da conta IG ou `/me` | ID da Página ou `/me` |
| Upload resumable (`rupload.facebook.com`) | Sim | **Não documentado** | Sim |
| Audio API (anexar áudio ao Reel) | Sim | **Não** | Sim |
| Delete de mídia | ❓ (a doc de IG Media diz "Facebook Login only") | Não | Sim (`instagram_manage_contents`) |
| Hashtag search / product tagging / partnership ads | Sim | Não | Sim |
| Webhook `story_insights` | Sim | Não | Sim |
| Novos recursos | "released only for this setup" | — | — |

Fontes: [overview](https://developers.facebook.com/documentation/instagram-platform/overview.md), [unified login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login.md), [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md), [audio api](https://developers.facebook.com/docs/instagram-platform/content-publishing/audio-api), [ig media](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media.md), [webhooks fields](https://developers.facebook.com/documentation/instagram-platform/webhooks/fields.md) — ✅

Uma restrição importante: "Your app can either use Facebook Login or Instagram Login but not both." [app review](https://developers.facebook.com/documentation/instagram-platform/app-review.md) ✅

### 3.2 Unified Login (recomendado)

Fluxo ✅ ([unified login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login.md), [authentication](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication.md)):
1. No App Dashboard, criar uma **configuração** com as permissões e os ativos desejados. Isso gera um `config_id` (que não é segredo) e uma URL de login.
2. O usuário faz login com Instagram ou Facebook e escolhe o portfólio, a conta IG e os outros ativos.
3. A Meta redireciona para a `redirect_uri` com um `code`.
4. O servidor troca o código em `GET https://graph.facebook.com/v27.0/oauth/access_token?client_id=<META_APP_ID>&client_secret=<META_APP_SECRET>&code=<CODE>`. A chamada deve ser feita de servidor para servidor.
5. Os IDs das contas IG vêm de `GET /me/assigned_instagram_accounts`. Com esse token, `/me` é o *system user*, não a conta IG.

Sobre o token:
- ✅ Ele "belongs to your client's business portfolio, not to the person who logged in" e "keeps working if that person leaves the business".
- ✅ A expiração depende da configuração definida no Dashboard. A doc não dá um prazo fixo. O token é gerido pela "Business Integration System User Access Token Management API", que exige a permissão `business_management` e o ID do negócio do cliente.
- ✅ O token deixa de funcionar se o app for removido do portfólio ou se a conta IG mudar de portfólio. Nesse caso, a recomendação é parar de tentar e pedir uma nova conexão.
- ❓ O prazo concreto e a chamada exata de refresh não estão descritos na página lida. Verificar na PoC.

Permissões (nomes exatos) ✅ ([permissions](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions.md)):
- Publicar: `instagram_basic`, `instagram_content_publish`
- Insights: `instagram_manage_insights` ("Read account and media insights")
- Comentários (opcional): `instagram_manage_comments`
- Gestão de token: `business_management`
- Outras listadas: `ads_management`, `ads_read`, `instagram_manage_events`, `instagram_manage_messages`, `instagram_shopping_tag_products`

### 3.3 Instagram Login (Business Login for Instagram)

✅ ([business login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login.md))
1. Autorização em `https://www.instagram.com/oauth/authorize?client_id=<IG_APP_ID>&redirect_uri=...&response_type=code&scope=...&state=...`. O sufixo `#_` do `code` deve ser removido.
2. Troca do código: `POST https://api.instagram.com/oauth/access_token` com `client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri` e `code`. O código vale 1h e só pode ser usado uma vez. O retorno é um token de curta duração (1h).
3. Token de longa duração: `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=...&access_token=<curto>`. Ele vale cerca de 60 dias (`expires_in` ≈ 5.183.944 s) e a troca precisa ser feita no servidor.
4. Refresh: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<longo>`. O token precisa ter pelo menos 24h, não pode estar expirado e exige `instagram_business_basic`. "Tokens that have not been refreshed in 60 days will expire and can no longer be refreshed."

Escopos: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages`. Para insights: `instagram_business_manage_insights` ([media insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights.md)) ✅. Os nomes antigos (`business_basic` etc.) foram depreciados em 27/01/2025 ([changelog](https://developers.facebook.com/documentation/instagram-platform/changelog.md)) ✅.

⚠️ No changelog, `enable_fb_login` aparece como depreciado em 14/06/2025 e depois como suportado, com padrão `true`, em 06/02/2026. O status é incerto, então fica ❓.

### 3.4 Facebook Login (Facebook Login for Business)

✅ ([FB get started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started.md), [long-lived tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived))
- O fluxo usa um token de usuário do Facebook. `GET /me/accounts` lista as Páginas, e `GET /{page-id}?fields=instagram_business_account` retorna o IG User ID.
- O token de usuário de longa duração dura "about 60 days" e é obtido com `grant_type=fb_exchange_token`. O Page token de longa duração "do not have an expiration date", mas pode ser invalidado em certas condições.
- Permissões para publicar: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`. Se o papel na Página vier via Business Manager, também `ads_management` ou `ads_read`. Para insights: `instagram_manage_insights`. Para listar Páginas: `pages_show_list`. [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md), [media insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights.md)
- Alternativa interna: o token de **System User** do Business Manager. A doc atual oferece "non-expiring" ou "expiring (60 dias)", recomenda os que expiram e diz que alguns negócios são obrigados a usá-los. [system users tokens](https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens) ❓ (lido só via resumo de busca; confirmar).

### 3.5 Recomendação

1. **Unified Login.** É o caminho recomendado pela Meta, recebe os recursos novos, usa um token do portfólio (sem depender de uma pessoa), não exige Página e oferece upload resumable e Audio API. Combina bem com "várias páginas do mesmo dono no mesmo portfólio".
2. **Plano B: Facebook Login**, se a Unified Login mostrar problemas na PoC. Exige uma Página do Facebook vinculada a cada conta IG. Como já existe análise de Facebook em `facebook.md`, há sinergia.
3. **Instagram Login** é a opção mais simples de configurar, mas não tem upload resumable documentado, nem Audio API, nem delete, e exige refresh do token a cada menos de 60 dias. Serve como fallback se o portfólio for um problema.

Arquitetura: guardar os tokens criptografados por conta IG, junto com o ID do negócio, e ter um job de verificação e refresh de token. Abstrair o host (`graph.facebook.com` ou `graph.instagram.com`) por conta.

---

## 4. Aprovação do app

| Ponto | O que a doc diz | Status | Fonte |
|---|---|---|---|
| Standard Access | "Permissions with Standard Access can only be requested from app users who have a role on the requesting app". Apps Business, Consumer e Gaming são "automatically approved for Standard Access for all permissions and features". | ✅ | [access levels](https://developers.facebook.com/documentation/development/graph-api/overview/access-levels) |
| App só para negócio próprio | Cenário "My app is only for a business I own or manage": Standard Access, App Review "Not required" (Instagram Login e Facebook Login) | ✅ | [app review](https://developers.facebook.com/documentation/instagram-platform/app-review.md) |
| Unified Login + Standard | "Saving your configuration gives your app Standard Access", o que permite testar com pessoas que têm papel no app. Para clientes sem papel: Advanced Access via App Review **e** app em Live mode. | ✅ | [unified permissions](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions.md) |
| Advanced Access | Necessário para atender contas que você não possui nem administra. Exige App Review **e** Business Verification. | 🔒 | [overview](https://developers.facebook.com/documentation/instagram-platform/overview.md) |
| Business Verification | Obrigatória para Advanced Access. Também é exigida quando os usuários do app não têm papel no app nem num negócio que reivindicou o app. | 🔒 | [overview](https://developers.facebook.com/documentation/instagram-platform/overview.md), [access levels](https://developers.facebook.com/documentation/development/graph-api/overview/access-levels) |
| Modo desenvolvimento | "Apps in Development mode can only request permissions from role users". Também diz: "Any data generated while an app is in Development mode, such as test posts, can only be seen by role users." | ✅ texto · ❓ aplicação ao IG | [app modes](https://developers.facebook.com/documentation/development/build-and-test/app-modes) |
| App Review: requisitos | Pelo menos uma chamada de API bem-sucedida, screencast por permissão, instruções para o revisor e app testável externamente | ✅ (só se um dia precisarmos) | [app review](https://developers.facebook.com/documentation/instagram-platform/app-review.md) |
| Apps privados | "Private apps" que os revisores não conseguem testar só podem pedir `instagram_basic` e `instagram_manage_comments`. Ou seja, não conseguiriam `instagram_content_publish` em Advanced. | ✅ | [overview](https://developers.facebook.com/documentation/instagram-platform/overview.md) |

**Implicação para uso interno:** o dono (ou a pessoa que opera a conta) deve ter um **papel no app**, como Admin, Developer ou Tester, e/ou o app deve pertencer ao mesmo business portfolio que é dono das contas IG. Assim, tudo funciona em **Standard Access, sem App Review e sem Business Verification**. Se um dia o sistema virar SaaS para terceiros, aí sim será preciso Advanced Access, App Review e Business Verification. 🔒

❓ **Riscos a validar na PoC:**
- A página de app modes diz que dados gerados em Development mode ficam visíveis só para usuários com papel. Ela não menciona Instagram. Precisamos confirmar que um Reel publicado por app em Development mode / Standard Access fica **público** no Instagram.
- Um resumo de busca indica que apps Business substituíram os modos por níveis de acesso, mas a página de app modes lida não confirma isso.
- Para Unified Login, a doc exige Live mode apenas para clientes sem papel.

---

## 5. Publicação de Reels passo a passo

Hosts: `graph.facebook.com` (Unified e Facebook Login) ou `graph.instagram.com` (Instagram Login). Upload resumable: `rupload.facebook.com`. ✅ [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md)

### 5.1 Opção A — Vídeo por URL pública (todas as variantes)

**Passo 1. Criar o container** ✅ ([ig-user/media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md))
```
POST https://<HOST>/v27.0/<IG_ID>/media
  media_type=REELS            (obrigatório)
  video_url=<URL pública>     (obrigatório; a Meta faz "cURL" do arquivo)
  caption=<texto>
  cover_url=<URL JPEG>        (opcional; tem prioridade sobre thumb_offset)
  thumb_offset=<ms>           (opcional; padrão 0 = primeiro frame)
  share_to_feed=true|false    (true = Feed + aba Reels; false = só aba Reels)
  collaborators=[...]         (até 3 usernames)
  audio_name=<nome>           (renomear o áudio original; só pode ser feito uma vez)
  user_tags=[...]             (usernames; x/y não se aplicam a Reels)
  location_id=<Page ID com localização>
  is_ai_generated=true        (opcional; autodeclaração de IA, changelog 22/06/2026)
  trial_params={"graduation_strategy":"MANUAL"|"SS_PERFORMANCE"}  (Trial Reels, opcional)
  access_token=...
→ { "id": "<IG_CONTAINER_ID>" }
```
Observação: a doc avisa que `share_to_feed` sozinho não garante a distribuição.

**Passo 2. Consultar o status** ✅
```
GET https://<HOST>/v27.0/<IG_CONTAINER_ID>?fields=status_code
```
Os valores possíveis são `IN_PROGRESS`, `FINISHED`, `PUBLISHED`, `ERROR` e `EXPIRED` (não publicado em 24h). A recomendação oficial é "querying a container's status once per minute, for no more than 5 minutes". O campo adicional `status` dá detalhe de erro. ❓ Vídeos longos podem levar mais que 5 minutos; tratar isso com backoff.

**Passo 3. Publicar** ✅ ([media_publish](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish.md))
```
POST https://<HOST>/v27.0/<IG_ID>/media_publish?creation_id=<IG_CONTAINER_ID>
→ { "id": "<IG_MEDIA_ID>", "config_issue"?: "CAPTION_NOT_ATTACHED"|"USER_TAGGING_FAILURE" }
```
O campo `config_issue` indica **sucesso parcial**: o post foi publicado, mas sem a legenda ou sem as marcações. A doc pede para tratar isso "as a signal to reconcile rather than as an error". A nossa pipeline precisa detectar e alertar quando isso acontecer. ✅

**Requisitos da URL:** a mídia precisa estar num servidor público no momento da publicação ✅. ❓ Uma URL pré-assinada (S3/R2) com validade de algumas horas deve funcionar, desde que fique acessível durante todo o processamento. Isso não está explicitado na doc; validar.

### 5.2 Opção B — Upload resumable (só Facebook Login for Business: Facebook Login e Unified Login)

✅ ([resumable uploads](https://developers.facebook.com/documentation/instagram-platform/content-publishing/resumable-uploads.md))
1. `POST https://graph.facebook.com/<IG_ID>/media?upload_type=resumable&media_type=REELS&caption=...` (aceita os mesmos opcionais da opção A). O retorno traz `id` e `uri`.
2. Upload: `POST https://rupload.facebook.com/ig-api-upload/<IG_CONTAINER_ID>` com os headers `Authorization: OAuth <TOKEN>`, `offset: 0` e `file_size: <bytes>`, enviando o arquivo binário. Outra forma é usar o header `file_url: <URL pública>` em vez do binário.
3. Para retomar após uma queda: consultar `GET /<IG_CONTAINER_ID>?fields=id,status,status_code,video_status` e reenviar com `offset = video_status.uploading_phase.bytes_transferred`.
4. Publicar com `media_publish`, igual à opção A.

⚠️ A página tem inconsistências nos exemplos: `upload_type` aparece no corpo JSON, o header de exemplo é `Bearer` em vez de `OAuth`, há um exemplo "interrupted" com `PUBLISHED` e um exemplo fixo em v19.0. ❓ Para Instagram Login, a página específica de upload não carregou ("Página não encontrada"), e o guia geral limita `upload_type=resumable` ao Facebook Login for Business.

**Recomendação:** usar o upload resumable (Unified Login), que evita expor os arquivos publicamente. Manter a opção por URL pré-assinada como fallback.

### 5.3 Música e áudio

- ✅ **Audio API** (changelog de 01/06/2026). Disponível só em Facebook Login e Unified Login. A doc diz: "It is not supported on the Instagram API with Instagram Login." A busca é `GET /ig_audio?audio_type=music|original_sound`, que retorna "audio that has been authorized for third party use". Para anexar, usar `audio_configuration={"audio_id":..., "audio_volume":1-100, "video_volume":1-100}` na criação do container. "Previewing a Reel with attached audio is not supported." [audio api](https://developers.facebook.com/docs/instagram-platform/content-publishing/audio-api)
- ✅ "Music tagging is only available for original audio" (limitação de Reels). [ig-user/media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md)
- ✅ `media_url` é omitido em vídeos com áudio protegido por direitos autorais; nesse caso, usar `permalink` ou `thumbnail_url` (changelog de 30/07/2026).
- ❓ Se a música vier "queimada" no vídeo original, o Instagram pode tratá-la por detecção de direitos autorais (mudo ou bloqueio). Isso não está documentado na API; validar.

### 5.4 Cover / thumbnail

- ✅ `cover_url`: JPEG, até 8 MB, sRGB, 9:16 recomendado. Fora de 9:16, a imagem é cortada no centro. `thumb_offset` em ms. O erro 2207057 ocorre quando o offset é inválido. [ig-user/media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md), [error codes](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes.md)
- ✅ `alt_text` **não** é suportado em Reels (só em imagens). [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md)

### 5.5 Outras limitações de Reels

✅ ([ig-user/media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md), [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md))
- Uma conta pode criar até **400 containers por 24h corridas**. Isso é diferente do limite de publicações.
- Reels não entram em carrosséis.
- Não há suporte a filtros nem a shopping tags (exceto product tagging, via Facebook ou Unified Login).
- As configurações de privacidade da conta valem no momento da publicação.
- O label de parceria paga (`is_paid_partnership`, `branded_content_sponsor_ids`, até 2 marcas) só existe com Facebook Login (changelog de 22/04/2026). A tabela do overview indica suporte também em Unified Login.

### 5.6 Futuro: imagem e carrossel

✅ ([content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md), [ig-user/media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md))
- **Imagem única:** `POST /<IG_ID>/media` com `image_url` e `caption` (e opcionalmente `alt_text`), depois `media_publish`. O formato aceito é **somente JPEG** (MPO e JPS não). O tamanho máximo é 8 MB, a proporção vai de 4:5 a 1.91:1 e a largura de 320 a 1440 px (fora disso, a imagem é redimensionada). sRGB.
- **Carrossel:** (1) criar um container para cada item com `is_carousel_item=true`; (2) criar o container `media_type=CAROUSEL` com `children=<ids separados por vírgula>`; (3) publicar. Para carrosséis, `is_ai_generated` vai só no container pai. Itens podem misturar imagem e vídeo. As imagens são cortadas na proporção da primeira (padrão 1:1). "Carousels count as a single post."
- ⚠️ **Limite de itens contraditório:** o guia diz "limited to 20 images, videos, or a mix". A tabela de erros (2207028) diz "at least 2 photos/videos and no more than 10". Fica ❓; tratar 10 como seguro até testar.
- Insights: "Insights data is not available for any media within an Instagram Media album" (só no álbum, não nos filhos). [media insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights.md)

---

## 6. Agendamento nativo

- ✅ **Não existe agendamento nativo de Instagram via API.** O guia de publicação não tem nenhum parâmetro do tipo `scheduled_publish_time`. A única menção a agendamento está na seção de Rate Limit, alertando sobre o limite "especially if your app allows app users to schedule posts to be published in the future". Isso pressupõe que **o app agenda por conta própria**. [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md)
- O changelog de 2024 a 2026 não tem nenhuma entrada sobre agendamento. [changelog](https://developers.facebook.com/documentation/instagram-platform/changelog.md) ✅

**Implicações para a arquitetura (nosso agendador próprio):**
1. Um job agendado (fila com horário de execução) dispara a criação do container, o polling e o `media_publish`.
2. **O container expira em 24h** ✅. Por isso, não dá para criar o container no momento da aprovação para um post que sai em 3 dias. O recomendado é criar o container cerca de 10 a 30 minutos antes do horário, consultar o status até `FINISHED` e publicar no horário. ❓ A antecedência ideal depende do tempo de processamento real.
3. Antes de publicar, consultar `content_publishing_limit` e respeitar o limite de 400 containers por 24h.
4. O token precisa estar válido no momento da execução. Isso exige monitoramento de expiração e alertas para reconexão.
5. Se o horário passar e houver falha, a política (tentar de novo, adiar ou notificar um humano) precisa ser definida por nós.

---

## 7. Especificações de vídeo para Reels via API

✅ Fonte: [ig-user/media (Reels specs)](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md)

| Item | Especificação |
|---|---|
| Container | MOV ou MP4 (MPEG-4 Part 14), **sem edit lists**, **moov atom no início** (faststart) |
| Codec de vídeo | HEVC ou H.264, varredura progressiva, **closed GOP**, croma 4:2:0 |
| Frame rate | 23–60 FPS |
| Resolução | Largura máxima de **1920 px** |
| Aspect ratio | 0.01:1 a 10:1; **9:16 recomendado** |
| Bitrate de vídeo | VBR, máximo de **25 Mbps** |
| Codec de áudio | AAC, até 48 kHz, mono ou estéreo |
| Bitrate de áudio | 128 kbps |
| Duração | **mínimo de 3 s, máximo de 15 min** |
| Tamanho máximo | **300 MB** |
| Capa (`cover_url`) | JPEG, ≤ 8 MB, sRGB, 9:16 recomendado (corte central) |

Erros ligados à especificação: 2207026 ("The video format is not supported"), que pede MOV/MP4. ✅ [error codes](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes.md)

**Para a pipeline de transcodificação** (sugestão derivada da especificação): exportar MP4 H.264 High, 1080x1920, 30 ou 60 fps, closed GOP, `-movflags +faststart`, AAC 48 kHz a 128 kbps, VBR abaixo de 25 Mbps e arquivo abaixo de 300 MB. ❓ "15 min" é o limite da API; se a distribuição em Reels de vídeos longos tem regras diferentes, isso não está documentado aqui.

---

## 8. Metadados

| Item | Limite | Status | Fonte |
|---|---|---|---|
| Legenda | **Máximo de 2200 caracteres** | ✅ | [ig-user/media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md); erro 2207010 em [error codes](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes.md) |
| Hashtags | **Máximo de 30** por legenda | ✅ | mesma fonte |
| Menções (@) | **Máximo de 20** @ tags (erro 2207040: "Cannot use more than {max-tag-count} tags") | ✅ | mesma fonte |
| Colaboradores | Até 3 usernames (não suportado em Stories) | ✅ | [ig-user/media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md) |
| User tags em Reels | Array de usernames, sem x/y | ✅ | mesma fonte |
| Codificação | A doc mostra um exemplo de URL-encoding de `user_tags`; caracteres especiais e emojis na legenda devem ser URL-encoded | ✅ (exemplo) · ❓ (detalhe) | [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md) |
| Edição de legenda após publicar | A atualização documentada de IG Media aceita só `comment_enabled` | ✅ (não há edição de legenda documentada) | [ig media](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media.md) |
| Rótulo de IA | `is_ai_generated=true` | ✅ | [changelog](https://developers.facebook.com/documentation/instagram-platform/changelog.md) |

A validação no nosso lado deve acontecer **antes** da aprovação humana: até 2200 caracteres, até 30 hashtags e até 20 @.

---

## 9. Limites e cotas

| Limite | Valor | Status | Fonte |
|---|---|---|---|
| Publicações por 24h (janela móvel, aplicado ao `media_publish`) | ⚠️ **50** (referências de `media_publish` e `content_publishing_limit`, e seção de carrossel) **ou 100** (seção "Rate Limit" do guia) | ❓ conflito; usar o endpoint em runtime | [media_publish](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish.md), [content_publishing_limit](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit.md), [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md) |
| Consulta do limite | `GET /<IG_ID>/content_publishing_limit?fields=config,quota_usage` (opcional `since`). `config.quota_total` ("currently 50"), `config.quota_duration` (86400 s), `quota_usage` | ✅ | [content_publishing_limit](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit.md) |
| Erro ao estourar | Código 9, subcódigo 2207042: "You reached maximum number of posts..." | ✅ | [error codes](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes.md) |
| Carrossel | Conta como um post | ✅ | [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md) |
| Containers por 24h | 400 | ✅ | [ig-user/media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md) |
| Expiração do container | 24h (`EXPIRED`) | ✅ | [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md) |
| Polling | 1 vez por minuto, por no máximo 5 min (recomendação) | ✅ | idem |
| Rate limit da Graph API (Instagram, BUC) | "Calls within 24 hours = 4800 * Number of Impressions", contado por par app + usuário. Business Discovery e Hashtag Search seguem o Platform Rate Limit. | ✅ | [rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting), [overview](https://developers.facebook.com/documentation/instagram-platform/overview.md) |
| Platform rate limit | "Calls within one hour = 200 * Number of Users" | ✅ | [rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting) |
| Códigos de rate limit | 4 (app), 17 (usuário), 32 (Pages), 613 (custom), 80002 (BUC Instagram). Headers `X-Business-Use-Case-Usage` e `X-App-Usage` | ✅ | [rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting) |
| Listagem de mídia | `GET /<IG_ID>/media` retorna até 10 mil mídias mais recentes (sem Stories), com paginação por `since`/`until` | ✅ | [ig-user/media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md) |

❓ Uma conta nova ou com poucas impressões tem um limite de chamadas proporcionalmente baixo (4800 × impressões). Para coleta de métricas, isso deve bastar, mas o ideal é monitorar os headers.

---

## 10. Métricas disponíveis

### 10.1 Insights de mídia (Reels)

✅ Endpoint `GET /<IG_MEDIA_ID>/insights?metric=<lista>` ([media insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights.md))

| Métrica | Descrição (doc) | Observação |
|---|---|---|
| `views` | "Total number of times IG Media has been played on Instagram" | Marcada "in development"; substitui `plays` |
| `reach` | Usuários únicos que viram o reel ao menos uma vez | Estimada |
| `likes` | Curtidas | Só orgânico |
| `comments` | Comentários | Só orgânico |
| `shares` | Compartilhamentos | |
| `saved` | Salvamentos | |
| `total_interactions` | Curtidas + salvamentos + comentários + compartilhamentos, menos desfeitos | In development; só orgânico |
| `ig_reels_avg_watch_time` | Tempo médio de reprodução | |
| `ig_reels_video_view_total_time` | Tempo total de reprodução, incluindo replays | In development |
| `reels_skip_rate` | % de visualizações iniciais que pularam nos primeiros 3 s | Estimada, in development (desde 03/12/2025) |
| `reposts` | Reposts menos reposts apagados | Desde 03/12/2025 |
| `facebook_views` | Reproduções no Facebook (crosspost ou cross-recommendation) | |
| `crossposted_views` | Reproduções somadas de IG e FB | Gera erro se o reel não foi compartilhado no FB |
| `total_views`, `total_likes`, `total_comments` | Totais incluindo mídia promovida | **Só Facebook Login** |

**Depreciadas** ✅ ([changelog](https://developers.facebook.com/documentation/instagram-platform/changelog.md)):
- `plays`, `clips_replays_count`, `ig_reels_aggregated_all_plays_count` e `impressions`: depreciadas na v22.0+ e em todas as versões em **21/04/2025** (substituídas por `views`, adicionada em 21/01/2025).
- `video_views`: depreciada na v21.0+ e em todas as versões em 08/01/2025.
- `impressions` em mídia: "For media created after July 2, 2024, this metric is deprecated".

**Latência e retenção** ✅:
- "Data used to calculate metrics can be delayed up to 48 hours."
- "Metrics data is stored for up to 2 years."
- Quando não há dado, a API retorna um conjunto vazio, não 0.

**Outros pontos:**
- ⚠️ Período: a doc lista `day`, `week`, `days_28`, `month`, `lifetime` e `total_over_range`, mas também diz que o período "is automatically set to `lifetime`". Para mídia, assumir lifetime. ❓
- Sem série temporal por mídia. Para ter curva de crescimento, **nós** precisamos coletar snapshots periódicos (por exemplo, em 1h, 6h, 24h, 48h, 7d e 30d).
- Métricas de feed (para posts de imagem e carrossel no futuro): as mesmas, mais `follows`, `profile_activity` (breakdown `action_type`) e `profile_visits`.
- Permissões: Unified (`instagram_basic` + `instagram_manage_insights`), Instagram Login (`instagram_business_basic` + `instagram_business_manage_insights`), Facebook Login (`instagram_basic` + `instagram_manage_insights` + `pages_read_engagement`, mais `ads_*` se o papel vier via BM).
- Campos básicos de IG Media úteis como métricas "baratas": `like_count`, `comments_count`, `permalink`, `timestamp`, `is_shared_to_feed`, `media_product_type`. ⚠️ A doc marca `caption` e `media_product_type` como "Facebook Login only", o que parece estranho e precisa ser validado. [ig media](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media.md)

### 10.2 Insights de conta

✅ `GET /<IG_ID>/insights` ([user insights](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights.md))
- Métricas: `accounts_engaged`, `comments`, `engaged_audience_demographics`, `follows_and_unfollows`, `follower_demographics`, `likes`, `profile_links_taps`, `reach`, `replies`, `reposts`, `saves`, `shares`, `total_interactions`, `views`. `impressions` foi depreciada (v22.0+ e todas as versões em 21/04/2025).
- `metric_type`: `total_value` em geral. Só `reach` (e a depreciada `impressions`) aceita `time_series`.
- Breakdowns: `media_product_type` (permite separar Reels), `follow_type`, `contact_button_type` e, para demografia, `age`, `city`, `country`, `gender`.
- Limiares: `follower_demographics` e `follows_and_unfollows` não aparecem com menos de 100 seguidores. `engaged_audience_demographics` exige pelo menos 100 engajamentos. A demografia retorna só o top 45.
- Latência de até 48h. Sem `since`/`until`, a janela padrão é de 24h.
- ⚠️ A tabela cita o breakdown `follower_type` para `views`, enquanto a seção de breakdowns cita `follow_type`.

---

## 11. Políticas relevantes

| Tema | O que diz | Status | Fonte |
|---|---|---|---|
| Conteúdo não original / reutilizado | Contas que postam principalmente conteúdo de terceiros (reupload) em fotos, carrosséis ou Reels deixam de aparecer em superfícies de recomendação. A regra vale para Reels desde 2024 e foi estendida em 30/04/2026. A elegibilidade é recalculada continuamente numa janela de 30 dias. | ✅ | [creators.instagram.com](https://creators.instagram.com/blog/rewarding-original-creators-on-instagram) |
| Marcas d'água | Adicionar "uma borda, marca d'água, legendas ou um crédito nas legendas" **não** torna o conteúdo original | ✅ | idem |
| Marca d'água de outra plataforma (ex.: logo TikTok) em Reels | Não encontrada em doc oficial lida | ❓ Boa prática: exportar o vídeo **original** sem marca de outra rede | — |
| Música licenciada | A Audio API retorna "audio that has been authorized for third party use". Música detectada como protegida faz `media_url` ser omitido. "Music tagging is only available for original audio." | ✅ | [audio api](https://developers.facebook.com/docs/instagram-platform/content-publishing/audio-api), [changelog](https://developers.facebook.com/documentation/instagram-platform/changelog.md), [ig-user/media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md) |
| Restrição de música para contas Business | Não especificada na doc da Audio API | ❓ | [audio api](https://developers.facebook.com/docs/instagram-platform/content-publishing/audio-api) |
| Conteúdo de marca / parceria paga | `is_paid_partnership` e `branded_content_sponsor_ids` (até 2 marcas) via Facebook Login. Não suportado em posts só para Close Friends nem em remixes. | ✅ | [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md), [changelog](https://developers.facebook.com/documentation/instagram-platform/changelog.md) |
| Rotulagem de IA | A API oferece `is_ai_generated=true`. Em que casos a rotulagem é **obrigatória** (Help Center) não foi possível ler. | ✅ (parâmetro) · ❓ (obrigatoriedade) | [changelog](https://developers.facebook.com/documentation/instagram-platform/changelog.md); help pages não legíveis |
| Consentimento para publicar | "Obtenha o consentimento das pessoas para publicar conteúdo ou realizar qualquer outra ação em nome delas" (Developer Policies, seção 1, item 7) | ✅ | [devpolicy](https://developers.facebook.com/devpolicy/) |
| Suporte | Oferecer um canal acessível de suporte e reporte (seção 1, item 8) | ✅ | idem |
| Plataforma Instagram | Respeitar as restrições que os donos colocam sobre o conteúdo. Não usar a plataforma "para simplesmente exibir Conteúdo do Usuário" (seção 6) | ✅ | idem |
| Spam | Erro 2207051, "We restrict certain activity to protect our community", quando a publicação é considerada spam | ✅ | [error codes](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes.md) |
| Platform Terms (retenção e exclusão de dados, política de privacidade) | Não verificados em detalhe nesta pesquisa | ❓ Ler https://developers.facebook.com/terms antes do go-live | — |

**Implicação:** uma página gamer que corta clipes de gameplay próprio é conteúdo original. Já reupload de clipes de terceiros (streamers, trailers) sem transformação substancial pode tirar a conta das recomendações. A legenda gerada por IA é texto, e o `is_ai_generated` se refere à **mídia**. ❓ Definir com o dono a política de quando marcar o post como gerado por IA.

---

## 12. Idempotência e erros comuns

### 12.1 Evitando publicação duplicada

✅ A doc **não** oferece chave de idempotência nem trata de retries no `media_publish`. A página de content publishing não menciona "duplicate" ou "idempotency". [media_publish](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish.md), [content publishing](https://developers.facebook.com/documentation/instagram-platform/content-publishing.md)

Estratégia proposta. Os campos e estados abaixo são documentados (✅); a estratégia em si é ❓ e deve ser validada:
1. **Um container por item agendado.** Persistir o `IG_CONTAINER_ID` no banco *antes* de chamar `media_publish`.
2. **Antes de qualquer retry do publish**, consultar `GET /<IG_CONTAINER_ID>?fields=status_code`. Se vier `PUBLISHED`, o post já saiu: **não republicar**, e sim reconciliar. O status `PUBLISHED` é documentado como "The container's media object has been published". ✅
3. **Reconciliação:** se não tivermos o `IG_MEDIA_ID` (por exemplo, timeout na resposta do publish), listar `GET /<IG_ID>/media?fields=id,timestamp,permalink,caption,media_product_type&since=<t>` e casar por timestamp e legenda. ⚠️ `caption` e `media_product_type` aparecem como "Facebook Login only" na doc de IG Media.
4. Lock distribuído ou máquina de estados por post (`AGENDADO → CONTAINER_CRIADO → PROCESSANDO → PRONTO → PUBLICANDO → PUBLICADO`), com transição atômica.
5. Container `EXPIRED` ou `ERROR`: criar um **novo** container (erros 2207020 e 2207053).
6. ✅ Delete de mídia existe (`instagram_manage_contents`, changelog de 03/12/2025) para corrigir uma duplicata, mas a doc de IG Media diz que só funciona com Facebook Login. ⚠️ A sintaxe na doc mostra POST e DELETE.

### 12.2 Códigos de erro relevantes

✅ ([error codes](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes.md))

| Código / subcódigo | Mensagem | Ação |
|---|---|---|
| -2 / 2207003 | "It takes too long to download the media." | Retry |
| -2 / 2207020 | "The media you are trying to access has expired..." | Criar novo container |
| -1 / 2207001 | Erro de servidor | Retry |
| -1 / 2207032 | "Create media fail, please try to re-create media" | Recriar container |
| -1 / 2207053 | "unknown upload error" | Novo container |
| 1 / 2207057 | Thumbnail offset inválido | Corrigir `thumb_offset` |
| 4 / 2207051 | "We restrict certain activity..." (spam) | Parar; revisão humana |
| 9 / 2207042 | Limite de posts da Content Publishing API | Reagendar para depois da janela de 24h |
| 24 / 2207006 | "The media with {id} cannot be found" | Verificar permissão e token; novo container |
| 24 / 2207008 | "The media builder with creation id ... does not exist or has been expired." | Retry 1–2x após 30 s a 2 min; depois, novo container |
| 25 / 2207050 | "The Instagram account is restricted." | Humano precisa resolver no app |
| 100 / 2207023 | Tipo de mídia desconhecido | Bug nosso |
| 100 / 2207028 | Carrossel fora de 2–10 itens | Validar |
| 100 / 2207040 | Excesso de @ tags (máx. 20) | Validar |
| 352 / 2207026 | Formato de vídeo não suportado | Transcodificar |
| 9004 / 2207052 | "The media could not be fetched from this uri" | URL não pública ou inválida |
| 9007 / 2207027 | "The media is not ready for publishing" | Esperar `FINISHED` |
| 36004 / 2207010 | Legenda longa demais | Validar 2200, 30 e 20 |
| 4, 17, 32, 613, 80002 | Rate limit | Backoff ([rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting)) |
| `(#10)` tipo de conta | Conta não é Business nem Creator | Converter a conta ([eligibility](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/eligibility-and-troubleshooting.md)) |

Sucesso parcial: o `config_issue` (`CAPTION_NOT_ATTACHED`, `USER_TAGGING_FAILURE`) aparece na resposta do `media_publish`. ✅

---

## 13. Webhooks úteis

✅ ([webhooks fields](https://developers.facebook.com/documentation/instagram-platform/webhooks/fields.md))
- **Não há webhook de status de container nem de "mídia publicada".** O polling é obrigatório.
- Campos disponíveis: `comments` (todas as variantes), `live_comments`, `mentions` (Unified e Facebook; em Instagram Login vem dentro de `comments`), `messages` e afins (Unified e Instagram Login), e `story_insights` (Unified e Facebook Login; **não** em Instagram Login).
- `story_insights` importa só se publicarmos Stories no futuro, porque as métricas de Story ficam disponíveis por apenas 24h. [media insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights.md)
- Para o MVP, os webhooks são **opcionais**. `comments` pode alimentar um painel de moderação futuro. Configuração em [webhooks setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup).

---

## 14. Tabela final

| Item | Status | Fonte |
|---|---|---|
| Três variantes de API (Unified, Instagram Login, Facebook Login); Unified recomendada para novas integrações | ✅ | https://developers.facebook.com/documentation/instagram-platform/overview.md |
| Novos recursos só na Unified Login | ✅ | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login.md |
| Unified exige business portfolio e não exige Página | ✅ | idem |
| Expiração do token da Unified depende da configuração (sem prazo fixo documentado) | ❓ | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication.md |
| Conta Business ou Creator obrigatória | ✅ | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/eligibility-and-troubleshooting.md |
| Facebook Login exige Página vinculada e tarefa MANAGE/CREATE_CONTENT | ✅ | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md |
| PPA e 2FA da Página podem bloquear a publicação (Facebook Login) | ✅ | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish.md |
| Instagram Login: código 1h, token curto 1h, longo 60 dias, refresh após 24h | ✅ | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login.md |
| Facebook Login: Page token de longa duração sem expiração | ✅ | https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived |
| Permissões de publicação (`instagram_content_publish` / `instagram_business_content_publish`) | ✅ | https://developers.facebook.com/documentation/instagram-platform/content-publishing.md |
| Permissões de insights (`instagram_manage_insights` / `instagram_business_manage_insights`) | ✅ | https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights.md |
| App só para negócio próprio: Standard Access, sem App Review | ✅ | https://developers.facebook.com/documentation/instagram-platform/app-review.md |
| Standard Access só para usuários com papel no app | ✅ | https://developers.facebook.com/documentation/development/graph-api/overview/access-levels |
| Advanced Access para terceiros (App Review + Business Verification) | 🔒 | https://developers.facebook.com/documentation/instagram-platform/overview.md |
| Posts de app em Development mode visíveis publicamente no IG | ❓ | https://developers.facebook.com/documentation/development/build-and-test/app-modes |
| Fluxo container → status → media_publish | ✅ | https://developers.facebook.com/documentation/instagram-platform/content-publishing.md |
| Parâmetros de Reels (cover_url, thumb_offset, share_to_feed, collaborators, audio_name, user_tags, location_id, trial_params, is_ai_generated) | ✅ | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md |
| Upload resumable via rupload.facebook.com (só Facebook Login for Business) | ✅ | https://developers.facebook.com/documentation/instagram-platform/content-publishing/resumable-uploads.md |
| Upload resumable em Instagram Login | ❓ (página não carregou) | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/upload-media.md |
| URL pré-assinada aceita como `video_url` | ❓ | — |
| Audio API (só Facebook e Unified Login) | ✅ | https://developers.facebook.com/docs/instagram-platform/content-publishing/audio-api |
| Container expira em 24h; 400 containers/24h | ✅ | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md |
| Sem agendamento nativo | ✅ | https://developers.facebook.com/documentation/instagram-platform/content-publishing.md |
| Especificações de vídeo de Reels (MP4/MOV, H.264/HEVC, 23–60 fps, ≤1920 px, 3 s–15 min, ≤300 MB, ≤25 Mbps) | ✅ | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md |
| Legenda: 2200 caracteres, 30 hashtags, 20 @ | ✅ | idem |
| Limite de publicação por 24h: 50 vs 100 | ❓ (doc contraditória) | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit.md |
| Endpoint `content_publishing_limit` | ✅ | idem |
| Carrossel: 20 vs 10 itens | ❓ (doc contraditória) | https://developers.facebook.com/documentation/instagram-platform/content-publishing.md · https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes.md |
| Rate limit BUC = 4800 × impressões / 24h | ✅ | https://developers.facebook.com/docs/graph-api/overview/rate-limiting |
| Métricas de Reels atuais (views, reach, etc.) | ✅ | https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights.md |
| Depreciação de plays, impressions, video_views, clips_replays_count, ig_reels_aggregated_all_plays_count | ✅ | https://developers.facebook.com/documentation/instagram-platform/changelog.md |
| Latência de até 48h e retenção de 2 anos | ✅ | https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights.md |
| Período das métricas de mídia (lifetime fixo?) | ❓ (doc ambígua) | idem |
| `caption` e `media_product_type` "Facebook Login only" | ❓ (doc estranha) | https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media.md |
| Política de conteúdo original (Reels 2024; fotos e carrosséis em 30/04/2026) | ✅ | https://creators.instagram.com/blog/rewarding-original-creators-on-instagram |
| Obrigatoriedade de rotular IA | ❓ | https://help.instagram.com/761121959519495 (não legível) |
| Sem idempotência nativa; usar `status_code` PUBLISHED para reconciliar | ✅ (ausência) · ❓ (estratégia) | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish.md |
| `config_issue` como sucesso parcial | ✅ | idem |
| Códigos de erro de publicação | ✅ | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes.md |
| Sem webhook de publicação; `story_insights` não existe em Instagram Login | ✅ | https://developers.facebook.com/documentation/instagram-platform/webhooks/fields.md |
| Delete de mídia (`instagram_manage_contents`, Facebook Login) | ✅ | https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media.md |
| Token de System User (non-expiring vs 60 dias) | ❓ (lido via resumo de busca) | https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens |

---

## 15. Fontes

- https://developers.facebook.com/documentation/instagram-platform/overview.md
- https://developers.facebook.com/docs/instagram-platform/overview
- https://developers.facebook.com/documentation/instagram-platform/llms.txt
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login.md
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication.md
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions.md
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/eligibility-and-troubleshooting.md
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login.md
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/upload-media.md (não carregou)
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/get-started.md
- https://developers.facebook.com/docs/instagram-platform/content-publishing
- https://developers.facebook.com/documentation/instagram-platform/content-publishing.md
- https://developers.facebook.com/documentation/instagram-platform/content-publishing/resumable-uploads.md
- https://developers.facebook.com/docs/instagram-platform/content-publishing/audio-api
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
- https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish.md
- https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit.md
- https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes.md
- https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media.md
- https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights.md
- https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights.md
- https://developers.facebook.com/documentation/instagram-platform/changelog.md
- https://developers.facebook.com/documentation/instagram-platform/webhooks/fields.md
- https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
- https://developers.facebook.com/documentation/instagram-platform/app-review.md
- https://developers.facebook.com/documentation/development/graph-api/overview/access-levels
- https://developers.facebook.com/documentation/development/build-and-test/app-modes
- https://developers.facebook.com/docs/graph-api/overview/rate-limiting
- https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
- https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens (via resumo de busca)
- https://developers.facebook.com/devpolicy/
- https://creators.instagram.com/blog/rewarding-original-creators-on-instagram
- https://help.instagram.com/761121959519495 (não legível)
- https://www.meta.com/help/artificial-intelligence/1783222608822690/ (não legível)
