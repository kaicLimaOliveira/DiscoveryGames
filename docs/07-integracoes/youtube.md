# YouTube — Análise da API oficial

> Pesquisado em 2026-11-15. Legenda: ✅ Confirmado · 🔒 Depende de aprovação · ❓ Hipótese a validar
>
> Método: leitura das páginas oficiais (developers.google.com/youtube, developers.google.com/identity, support.google.com) via WebFetch nesta data. Onde a página não continha a informação, ou houve conflito entre fontes, o item está marcado como ❓. Atenção: a API mudou muito em 2025–2026 (cotas, auditoria, thumbnails de Shorts). Material de terceiros ou de antes de 2026 provavelmente está desatualizado.

---

## 1. Resumo executivo

- ✅ **Upload por API oficial**: `videos.insert` com upload resumable. Arquivo de até 256 GB, MIME `video/*` ou `application/octet-stream`. O mesmo método serve para Shorts e vídeos longos. [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- ✅ **Não existe flag "Short" na API.** O YouTube classifica como Short o vídeo **quadrado ou vertical com até 3 minutos** (para canais comuns, uploads desde 15/10/2024). A decisão fica no formato do arquivo que a gente gera, não no payload. [Ajuda: Shorts de 3 min](https://support.google.com/youtube/answer/15424877)
- ✅ **Mudança importante (02/11/2026)**: projetos de API **não verificados não ficam mais restritos a "privado"**. A regra de 28/07/2020 foi revogada. [Revision history](https://developers.google.com/youtube/v3/revision_history)
- ✅ **Cotas novas (desde 01/06/2026)**: são buckets separados. `videos.insert` tem **100 chamadas/dia** (1 unidade por chamada), `search.list` tem 100 chamadas/dia, e os demais métodos dividem **10.000 unidades/dia**. `thumbnails.set` e `videos.update` custam ~50 cada. [Quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost)
- ✅ **Agendamento nativo**: `status.publishAt`, que só vale com `privacyStatus=private` e em vídeo nunca publicado. [videos resource](https://developers.google.com/youtube/v3/docs/videos)
- ✅ **Thumbnail customizada em Shorts via API** (desde 03/11/2026). Chamar `thumbnails.set` só depois de `processingStatus=succeeded`. [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set)
- ✅ **Divulgação de IA**: o campo é `status.containsSyntheticMedia` (boolean). Gameplay e títulos/descrições gerados por IA **não** exigem divulgação. [videos resource](https://developers.google.com/youtube/v3/docs/videos), [Ajuda: conteúdo sintético](https://support.google.com/youtube/answer/14328491)
- ✅ **OAuth em modo "Testing"**: o refresh token **expira em 7 dias** (app External). Para operar sem reautenticar toda semana, o app tem que sair de Testing. [Google OAuth2](https://developers.google.com/identity/protocols/oauth2)
- ✅ **Métricas**: YouTube Analytics API `reports.query`, com latência típica de **48–72 h**. Para números quase em tempo real, usar `videos.list` (statistics). Para Shorts há `engagedViews`, `creatorContentType=SHORTS` e retenção via `elapsedVideoTimeRatio`. [Data model](https://developers.google.com/youtube/analytics/data_model), [Metrics](https://developers.google.com/youtube/analytics/metrics)
- ✅ **Políticas que afetam o produto**: o humano precisa ter controle final do que é publicado e consentimento expresso para ações automatizadas. Não alterar metadados do usuário sem consentimento. **Um projeto de API por cliente de API.** Dados autorizados guardados precisam ser atualizados ou apagados a cada 30 dias. [Developer Policies](https://developers.google.com/youtube/terms/developer-policies)

---

## 2. Pré-requisitos

| Item | Detalhe | Status | Fonte |
|---|---|---|---|
| Projeto no Google Cloud | Necessário para criar credenciais OAuth e habilitar as APIs. As políticas exigem **um API Project por API Client**, sem reaproveitar o projeto em outro cliente. Vários canais do mesmo dono podem usar o mesmo cliente (o mesmo sistema). | ✅ (regra de projeto) / ❓ (interpretação multi-canal) | [Developer Policies III.D.1.c](https://developers.google.com/youtube/terms/developer-policies) |
| Habilitar APIs | YouTube Data API v3, YouTube Analytics API e, opcionalmente, YouTube Reporting API no console | ✅ | [Getting started](https://developers.google.com/youtube/v3/getting-started) |
| Tela de consentimento OAuth | Tipo de usuário (Internal/External) e status de publicação (Testing/In production). Ver seção 3. | ✅ | [OAuth2](https://developers.google.com/identity/protocols/oauth2), [Verificação não necessária](https://support.google.com/cloud/answer/13464323) |
| Canal do YouTube | O usuário que autoriza precisa ter o canal (ou acesso a ele) | ✅ (implícito, `channel==MINE` etc.) | [reports.query](https://developers.google.com/youtube/analytics/reference/reports/query) |
| Verificação da conta para vídeos > 15 min | O padrão é até 15 min. Verificar a conta (código por SMS ou voz) libera vídeos mais longos. O limite absoluto é **256 GB ou 12 h**, o que vier primeiro. Para Shorts (≤ 3 min) isso não importa; vai importar para vídeos longos no futuro. | ✅ | [Ajuda: upload > 15 min](https://support.google.com/youtube/answer/71673) |
| Política de privacidade e link para os ToS do YouTube | Exigido de qualquer API Client, inclusive uso interno: link para os ToS do YouTube e para a Privacy Policy do Google, e explicação de como revogar o acesso | ✅ | [Developer Policies III.A](https://developers.google.com/youtube/terms/developer-policies) |
| Links clicáveis na descrição | URLs clicáveis exigem elegibilidade do canal (por ex. verificação/recursos avançados) | ✅ | [videos resource](https://developers.google.com/youtube/v3/docs/videos) |

---

## 3. Autenticação

### 3.1 Fluxo
- ✅ OAuth 2.0 para web server apps com `access_type=offline`, que devolve o refresh token na primeira troca do código. `include_granted_scopes=true` permite autorização incremental. Sem `prompt`, o consentimento só aparece na primeira vez; `prompt=consent` força o consentimento de novo. [Server-side web apps](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps)
- ✅ O refresh token vale até o usuário revogar ou até expirar. `invalid_grant` indica token expirado ou invalidado. Nesse caso é preciso refazer o consentimento. [Server-side web apps](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps)
- ✅ Limite de **100 refresh tokens por conta Google por client ID**. Um token novo invalida o mais antigo **sem aviso**. Consequência para a arquitetura: guardar um token por canal e não "re-logar" à toa. [OAuth2](https://developers.google.com/identity/protocols/oauth2)

### 3.2 Escopos (lista oficial)
Fonte: [OAuth 2.0 Scopes](https://developers.google.com/identity/protocols/oauth2/scopes) ✅

| Escopo | Descrição oficial | Uso no projeto |
|---|---|---|
| `https://www.googleapis.com/auth/youtube.upload` | Manage your YouTube videos | Upload (`videos.insert`) e `thumbnails.set` |
| `https://www.googleapis.com/auth/youtube` | Manage your YouTube account | Mais amplo. Necessário para `videos.update` ❓ (confirmar na página do método) |
| `https://www.googleapis.com/auth/youtube.force-ssl` | See, edit, and permanently delete your YouTube videos, ratings, comments and captions | Alternativa ampla (comentários, legendas) |
| `https://www.googleapis.com/auth/youtube.readonly` | View your YouTube account | `videos.list` de vídeos próprios, `channels.list` |
| `https://www.googleapis.com/auth/yt-analytics.readonly` | View YouTube Analytics reports for your YouTube content | Analytics e Reporting API |
| `https://www.googleapis.com/auth/yt-analytics-monetary.readonly` | View monetary and non-monetary YouTube Analytics reports | Receita (só se o canal estiver no YPP; senão HTTP 403) |
| `https://www.googleapis.com/auth/youtubepartner` | View and manage your assets... | Só para parceiros CMS. **Não usar.** |

- ✅ `videos.insert` aceita `youtube.upload`, `youtube`, `youtubepartner` ou `youtube.force-ssl`. [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- ✅ `thumbnails.set` aceita os mesmos quatro. [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set)
- ❓ **Inconsistência na doc**: a página de `reports.query` tem um banner dizendo que as requisições "now require access to the `youtube.readonly` scope", mas a tabela de escopos da mesma página não lista esse escopo. **Recomendação:** pedir `yt-analytics.readonly` **e** `youtube.readonly` e validar em teste. [reports.query](https://developers.google.com/youtube/analytics/reference/reports/query)
- ✅ Políticas: pedir só os escopos realmente usados e, quando possível, pedir no contexto. [Developer Policies III.D.2.1](https://developers.google.com/youtube/terms/developer-policies)

**Conjunto mínimo sugerido (❓, validar):** `youtube.upload` + `youtube.readonly` + `yt-analytics.readonly`, e `youtube` só se precisarmos editar metadados depois do upload.

### 3.3 Status "Testing" e refresh tokens de 7 dias
- ✅ Texto oficial: um projeto com tela de consentimento **External** e status **"Testing"** "is issued a refresh token expiring in 7 days", exceto quando os únicos escopos são nome, e-mail e perfil. Os escopos do YouTube não entram na exceção. [OAuth2](https://developers.google.com/identity/protocols/oauth2)
- **Impacto:** em Testing o dono teria que reautorizar a cada 7 dias, o que inviabiliza agendamento e coleta de métricas sem supervisão.

### 3.4 Verificação do app OAuth
- ✅ Apps com escopos sensíveis ou restritos precisam passar pela verificação do Google antes de ter acesso. [Cloud: verificação](https://support.google.com/cloud/answer/13463073)
- ✅ Casos em que a verificação **não** é necessária: **uso pessoal (< 100 usuários)**; apps em desenvolvimento/testing (com tela de "app não verificado" e limite de 100 usuários); apps **Internal** (só usuários da organização Workspace/Cloud Identity, sem tela de não verificado e sem limite de 100). [Quando a verificação não é necessária](https://support.google.com/cloud/answer/13464323)
- ❓ Classificação de cada escopo do YouTube como "sensível" ou "restrito": a página consultada não lista isso. Validar no console (o console mostra a classificação ao adicionar o escopo).
- ❓ **Caminho provável para uso interno**: app External em **"In production"** sem verificação, apoiado na exceção de uso pessoal (< 100 usuários), com o dono aceitando a tela de "app não verificado". A hipótese é que assim o refresh token não expire em 7 dias, já que a regra de 7 dias cita só "Testing". **Validar na prática** antes de fechar a arquitetura.
- ❓ Alternativa **Internal**: só funciona se a conta Google dona do canal (ou a Brand Account) pertencer a uma organização Google Workspace. Validar como o canal do cliente está vinculado.

---

## 4. Auditoria / compliance

- ✅ **Regra de 2020 revogada**: em **02/11/2026** o YouTube reverteu a política de 28/07/2020. Vídeos enviados por `videos.insert` de projetos não verificados "no longer restricted to private viewing mode". Sem `privacyStatus`, o padrão é `public`, mas as configurações da conta do criador podem fazer alguns uploads começarem como `private`. [Revision history (02/11/2026)](https://developers.google.com/youtube/v3/revision_history), [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
  - Muitos guias antigos ainda citam a restrição a privado. **Não usar como referência.**
  - **Recomendação:** sempre enviar `privacyStatus` explícito e conferir o valor efetivo com `videos.list` depois do upload (por causa do padrão da conta).
- 🔒 **Auditoria de compliance** ainda é **obrigatória para aumentar a cota**. O projeto precisa demonstrar conformidade com os ToS e as Developer Policies. Formulário: [YouTube API Services Audit and Quota Extension Form](https://support.google.com/youtube/contact/yt_api_form). Prazo: "A member of YouTube's API Services team will contact you as soon as possible", sem SLA. [Quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)
  - Recurso de auditoria reprovada: [Appeals Form](https://support.google.com/youtube/contact/yt_api_appeals). Auditoria periódica: formulário ligado à mesma página.
  - ✅ Desde 01/06/2026 é possível pedir aumento **por método**. [Revision history](https://developers.google.com/youtube/v3/revision_history)
- ✅ Na auditoria, o YouTube pode pedir contas com acesso a todas as funcionalidades do cliente em produção. Também não se pode esconder o uso da API. [Developer Policies III.H](https://developers.google.com/youtube/terms/developer-policies)
- ✅ Um projeto inativo por **90 dias consecutivos** pode ter o acesso reduzido. [Developer Policies III.D.4](https://developers.google.com/youtube/terms/developer-policies)

### Developer Policies: pontos que afetam diretamente o produto
Fonte: [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies) ✅

| Regra | Seção | Impacto na arquitetura |
|---|---|---|
| O usuário tem controle final do que é publicado. Sugestões de título/descrição são permitidas, desde que o usuário controle o conteúdo final. | III.C.3 / III.C.3.a | O fluxo "IA sugere → humano aprova" está alinhado. Guardar evidência da aprovação. |
| Identificar ações de inserir/atualizar/apagar e obter consentimento **expresso** antes de executar. Agendamentos entram nisso. | III.E.3.d | Tela de aprovação explícita por publicação, com log de quem aprovou e quando. |
| Não mudar a visibilidade sem instrução expressa do usuário | III.E.3.f | Mudança de privado para público só com aprovação. |
| Não automatizar uploads sem consentimento específico e expresso | III.I.2 | Mesmo ponto acima. |
| Não alterar valores fornecidos pelo usuário (truncar, acrescentar texto) sem consentimento | III.C.3 | Não anexar hashtags ou rodapés automaticamente depois da aprovação. A validação de limites tem que acontecer **antes** da aprovação. |
| Dados autorizados: apagar ou atualizar depois de 30 dias. Dados de Analytics podem ser guardados, mas é preciso reconfirmar a autorização a cada 30 dias. | III.E.4.b/c | Job periódico de atualização de dados e de checagem do token. |
| Revogação: revogar o token programaticamente e apagar os dados em 7 dias (30 dias se a revogação for pelo painel do Google) | III.D.2.3 | Botão "desconectar canal" com rotina de purge. |
| Não baixar nem guardar cópias do audiovisual **do YouTube** sem autorização | III.E.1.a | Guardar o **nosso arquivo original** é diferente de baixar do YouTube. ❓ Confirmar a interpretação (entendemos que se refere a conteúdo obtido do YouTube). |
| Um projeto por API Client. Não criar projetos extras para contornar limites. | III.D.1.c / III.D.6 | Um projeto GCP para a central inteira (todos os canais). |
| Criptografia em trânsito e proteção dos dados | III.E.5 | Tokens criptografados em repouso. |

---

## 5. Upload passo a passo

### 5.1 Fluxo recomendado
1. ✅ **Iniciar a sessão resumable**: `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` com o recurso `video` no corpo (JSON) e os headers `Authorization`, `Content-Type: application/json; charset=UTF-8`, `X-Upload-Content-Length` e `X-Upload-Content-Type`. [Resumable upload](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
2. ✅ A resposta `200 OK` traz o header `Location` com a **session URI**. **Persistir esse valor** (ver seção 13).
3. ✅ `PUT` do binário na session URI, inteiro ou em chunks **múltiplos de 256 KB** (menos o último), com `Content-Range`. Chunks intermediários retornam `308 Resume Incomplete`; o final retorna `201 Created` com o recurso `video` (incluindo `id`). [Resumable upload](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
4. ✅ Acompanhar o processamento com `videos.list?part=status,processingDetails`: `processingDetails.processingStatus` assume `processing`, `succeeded`, `failed` ou `terminated`. `status.uploadStatus` assume `uploaded`, `processed`, `failed`, `rejected` ou `deleted`. Se for `rejected`, `rejectionReason` vem com `duplicate`, `copyright`, `length` etc. [videos resource](https://developers.google.com/youtube/v3/docs/videos)
5. ✅ Depois de `succeeded`, opcionalmente chamar `thumbnails.set` (também em Shorts). [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set)

### 5.2 Campos do corpo
Fonte principal: [videos resource](https://developers.google.com/youtube/v3/docs/videos) ✅

| Campo | Regra / observação | Status |
|---|---|---|
| `snippet.title` | Máx. **100 caracteres**. Sem `<` ou `>`. | ✅ |
| `snippet.description` | Máx. **5.000 bytes** (bytes, não caracteres: acentos e emojis ocupam mais). Sem `<` ou `>`. Timestamps `00:00` viram capítulos. | ✅ |
| `snippet.tags[]` | Máx. **500 caracteres no total**. As vírgulas contam, e tags com espaço contam como se estivessem entre aspas ("Foo Baz" = 9). | ✅ |
| `snippet.categoryId` | ID da categoria (para um canal gamer, a de Gaming). ❓ Obter o ID via `videoCategories.list` em vez de deixar fixo no código. | ✅ campo / ❓ valor |
| `snippet.defaultLanguage` | Idioma do título e da descrição | ✅ |
| `snippet.defaultAudioLanguage` | Idioma do áudio | ✅ |
| `status.privacyStatus` | `private`, `public` ou `unlisted`. Padrão `public` no insert, mas a configuração da conta pode forçar `private`. | ✅ |
| `status.publishAt` | ISO 8601. Ver seção 7. | ✅ |
| `status.selfDeclaredMadeForKids` | Boolean. Declara o vídeo como direcionado a crianças. (Desde 15/10/2026 a doc esclarece que só muda quando é enviado na requisição.) | ✅ |
| `status.containsSyntheticMedia` | Boolean. Divulga conteúdo realista alterado ou sintético (A/S). Introduzido em 30/10/2024. | ✅ [revision history](https://developers.google.com/youtube/v3/revision_history) |
| `status.embeddable`, `status.license` | `license`: `youtube` ou `creativeCommon` | ✅ |
| Parâmetro `notifySubscribers` | Boolean, padrão `true`. A doc sugere `false` para canais que sobem muitos vídeos. | ✅ [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| Parte `brandPartner` | Nova (07/07/2026), para vincular parceiro de marca (conteúdo patrocinado) | ✅ [revision history](https://developers.google.com/youtube/v3/revision_history) |

### 5.3 Thumbnails
- ✅ `thumbnails.set`: custa ~50 unidades. **Máx. 50 MB** (era 2 MB até 14/09/2026). Aceita `image/jpeg`, `image/png` e `application/octet-stream`. [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set), [revision history](https://developers.google.com/youtube/v3/revision_history)
- ✅ **Shorts aceitam thumbnail customizada via API desde 03/11/2026**, desde que a chamada aconteça depois de o processamento terminar. O recurso `thumbnails` ganhou a chave `shortsAspectRatio` (9:16). [thumbnails resource](https://developers.google.com/youtube/v3/docs/thumbnails)
- ❓ A página do método não traz requisitos de proporção ou resolução da imagem. Recomendamos gerar 9:16 para Shorts e 16:9 para longos, mas isso é hipótese.
- ✅ Erro `429 uploadRateLimitExceeded` quando muitas thumbnails são enviadas em pouco tempo. Exige backoff.

---

## 6. Shorts: classificação

- ✅ **Duração**: até **3 minutos** para canais comuns, valendo para vídeos enviados **a partir de 15/10/2024**. Vídeos anteriores continuam como formato longo. (Para Official Artist Channels a data é 08/12/2025.) [Ajuda: Shorts de 3 min](https://support.google.com/youtube/answer/15424877)
- ✅ **Proporção**: vídeos com enquadramento **quadrado ou vertical** de até 3 min são "categorized as Shorts". Para evitar a classificação, a recomendação é usar quadro mais largo (16:9). [Ajuda: Shorts de 3 min](https://support.google.com/youtube/answer/15424877)
- ✅ **Resolução**: a página de Shorts diz que dá para enviar com resolução máxima de **1080p**. [Ajuda: upload de Shorts](https://support.google.com/youtube/answer/10059070)
- ✅ **Sem flag na API**: nem o recurso `videos` nem `videos.insert` têm um campo para marcar Short. A única menção a Shorts no recurso `videos` está na nota de `viewCount`. Isso é uma conclusão por ausência, verificada nas duas páginas em 2026-11-15. [videos resource](https://developers.google.com/youtube/v3/docs/videos), [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- ❓ **#Shorts no título/descrição**: a página de hashtags e a página de Shorts **não** documentam efeito de `#Shorts` na classificação. Na doc atual, a classificação depende de duração e proporção. Colocar `#Shorts` é inofensivo, mas não há evidência oficial de que seja necessário. [Ajuda: hashtags](https://support.google.com/youtube/answer/6390658)
- ❓ **Leitura posterior do formato**: a Data API não informa se o vídeo virou Short. Uma forma indireta é a dimensão `creatorContentType` (valor `SHORTS`) da Analytics API (seção 11), que tem a latência do Analytics.
- ✅ **Content ID em Shorts > 1 min**: a página atual (en-GB, lida em 2026-11-15) diz que Shorts acima de 1 minuto "with an active Content ID claim of any type, including manual claims, will be blocked globally on YouTube". Um Short bloqueado não toca, não é recomendado e não monetiza, mas não gera penalidade no canal. Shorts com menos de 1 min não estão sujeitos a esse bloqueio. [Ajuda: Shorts de 3 min](https://support.google.com/youtube/answer/15424877?hl=en-GB)
  - ❓ Um resumo de busca citou mudança a partir de 24/09/2026 (fim do bloqueio automático), mas **essa data não aparece na página lida**. Tratar como não confirmado.
- ✅ Músicas da biblioteca de áudio de Shorts: a maioria pode ser usada por até 90 s num Short de 3 min (algumas faixas só 60 ou 30 s). [Ajuda: Shorts de 3 min](https://support.google.com/youtube/answer/15424877?hl=en-GB)

**Impacto:** o pipeline de render precisa garantir vertical (9:16) e ≤ 3:00. Para manter flexibilidade com música licenciada, vale considerar ≤ 1:00 quando houver risco de claim.

---

## 7. Agendamento nativo (`publishAt`)

- ✅ `status.publishAt` (ISO 8601) **só pode ser definido quando `privacyStatus` é `private` e o vídeo nunca foi publicado**. [videos resource](https://developers.google.com/youtube/v3/docs/videos)
- ✅ No `videos.update` é obrigatório reenviar `privacyStatus: private` junto, mesmo que o vídeo já esteja privado. [videos resource](https://developers.google.com/youtube/v3/docs/videos)
- ✅ Um `publishAt` no passado publica na hora, como se o vídeo passasse de private para public. [videos resource](https://developers.google.com/youtube/v3/docs/videos)
- ✅ Um valor inválido gera o erro `invalidPublishAt` (400). [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)

**Implicações para a arquitetura:**
- O agendamento pode ficar **no YouTube**: o upload acontece logo depois da aprovação, com `private` + `publishAt`. Assim não dependemos do nosso scheduler estar no ar na hora da publicação, e o processamento termina antes do horário.
- Reagendar custa um `videos.update` (~50 unidades). Cancelar = remover o `publishAt`, ou manter privado. ❓ Validar o payload exato do cancelamento.
- Como o vídeo nunca foi publicado, dá para ajustar thumbnail e metadados antes do horário.
- ❓ A doc não informa antecedência máxima ou mínima para o `publishAt`. Testar.

---

## 8. Especificações de vídeo/upload recomendadas

Fonte: [Ajuda: configurações de codificação recomendadas](https://support.google.com/youtube/answer/1722171) ✅. Obs.: a página tem um aviso de que certos recursos são "only available to partners who use YouTube Studio Content Manager". Pela leitura, o aviso parece valer para recursos específicos (por ex. alguns formatos de áudio), e não para a tabela inteira. ❓ Confirmar.

| Item | Recomendação |
|---|---|
| Contêiner | **MP4**, sem edit lists, com moov atom no início (Fast Start) |
| Vídeo | **H.264**, progressivo, High Profile, 2 B-frames consecutivos, GOP fechado de meia taxa de quadros, CABAC, VBR, chroma 4:2:0 |
| Áudio | **AAC-LC** (ou Opus/Eclipsa), estéreo ou estéreo + 5.1, **48 kHz**. Bitrate: estéreo 384 kbps, mono 128, 5.1 512 |
| FPS | Mesmo da gravação (24/25/30/48/50/60). Desentrelaçar antes do envio. |
| Bitrate SDR 1080p | **8 Mbps** (padrão) / **12 Mbps** (alta taxa de quadros, 48–60 fps) |
| Bitrate SDR 720p | 5 / 7,5 Mbps |
| Bitrate SDR 1440p | 16 / 24 Mbps |
| Bitrate SDR 4K | 35–45 / 53–68 Mbps |
| Cor (SDR) | BT.709 |
| Proporção | 16:9 é o padrão em desktop. Vertical e quadrado são aceitos, e o player se adapta. |
| Shorts | Vertical, ≤ 3 min, até **1080p** ([10059070](https://support.google.com/youtube/answer/10059070)). Sugestão prática: 1080×1920, H.264, 8–12 Mbps (❓ derivado das tabelas acima, não há tabela específica de Shorts). |
| Tamanho máximo | **256 GB** (API: [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert); Ajuda: 256 GB ou 12 h, o menor, [71673](https://support.google.com/youtube/answer/71673)) |
| Duração máxima | 15 min sem verificação da conta, até 12 h com verificação ([71673](https://support.google.com/youtube/answer/71673)) |

---

## 9. Metadados: limites

| Item | Limite | Status | Fonte |
|---|---|---|---|
| Título | 100 caracteres. Sem `<` ou `>`. | ✅ | [videos resource](https://developers.google.com/youtube/v3/docs/videos) |
| Descrição | 5.000 **bytes**. Sem `<` ou `>`. | ✅ | idem |
| Tags | 500 caracteres no total, com vírgulas e aspas implícitas contando | ✅ | idem |
| Hashtags: mais de 60 | "If a video or playlist has more than 60 hashtags, we'll ignore each hashtag on that content." | ✅ | [Ajuda: hashtags](https://support.google.com/youtube/answer/6390658) |
| Hashtags exibidas acima do título | Até 3 hashtags da descrição consideradas mais engajadoras | ✅ | idem |
| Hashtags sem espaço | Sim (#DuasPalavras) | ✅ | idem |
| Hashtags não relacionadas | Proibidas. Podem levar à remoção. | ✅ | idem |
| Erros de validação | `invalidTitle`, `invalidDescription`, `invalidTags`, `invalidCategoryId`, `defaultLanguageNotSet` (400) | ✅ | [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |

**Impacto:** o validador precisa contar **bytes UTF-8** na descrição, aplicar a regra de contagem de tags (aspas e vírgulas) e limitar hashtags (bem abaixo de 60), tudo **antes** da tela de aprovação. Depois de aprovado, o texto não pode ser alterado (Developer Policies III.C.3).

---

## 10. Cotas

### 10.1 Modelo atual (desde 01/06/2026)
- ✅ Padrão por projeto: **100 chamadas `search.list`/dia**, **100 chamadas `videos.insert`/dia** e **10.000 unidades/dia** para todos os outros endpoints somados. [Getting started](https://developers.google.com/youtube/v3/getting-started), [Quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost)
- ✅ Reset à **meia-noite, horário do Pacífico**. [Quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost)
- ✅ Histórico: o custo do upload caiu de ~1.600 para ~100 unidades em 04/12/2025. Em 01/06/2026 vieram os buckets granulares (insert e search com bucket próprio). [Revision history](https://developers.google.com/youtube/v3/revision_history)
- ✅ Novo `videos.batchGetStats` (03/06/2026): 1 unidade em bucket próprio, padrão de 10.000/dia. [Revision history](https://developers.google.com/youtube/v3/revision_history) ❓ Ainda não lemos a página do método (parâmetros e limites).

### 10.2 Custos por método
Fonte: [Quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost) ✅

| Método | Custo | Bucket |
|---|---|---|
| `videos.insert` | 1 por chamada (100 chamadas/dia) | próprio |
| `search.list` | 1 por chamada (100 chamadas/dia) | próprio |
| `videos.list` | 1 | geral (10.000) |
| `channels.list` | 1 | geral |
| `commentThreads.list` | 1 | geral |
| `videos.update` | 50 | geral |
| `thumbnails.set` | 50 | geral |
| `playlistItems.insert` | 50 | geral |
| `captions.insert` | 400 | geral |

### 10.3 Quantos uploads cabem por dia (cota padrão)
- **Teto por cota de projeto: 100 uploads/dia**, limitado pelo bucket de `videos.insert`. ✅ (derivado das fontes acima)
- Cenário "upload + thumbnail + 1 reagendamento + ~10 polls de `videos.list`": 50 + 50 + 10 = 110 unidades por vídeo no bucket geral, ou seja, ~90 vídeos/dia. Para um canal (e mesmo vários) isso sobra.
- ⚠️ **A cota é por projeto, não por canal.** Com vários canais no mesmo projeto, os 100 uploads/dia são divididos entre todos. (Lembrando: as políticas pedem um projeto por API Client.)
- ✅ **Limite por canal, separado da cota**: `uploadLimitExceeded` (400), "The channel's daily video upload limit has been reached". É uma restrição da plataforma, independente da cota do projeto. **O número não é publicado.** ❓ [Errors](https://developers.google.com/youtube/v3/docs/errors)
- ❓ A Analytics API não documenta custo de cota em `reports.query` na página consultada.

### 10.4 Aumento de cota
- 🔒 Via [Audit and Quota Extension Form](https://support.google.com/youtube/contact/yt_api_form), com auditoria de compliance obrigatória. Desde 06/2026 dá para pedir por método. Sem SLA publicado. [Quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)

---

## 11. Métricas

### 11.1 YouTube Analytics API: `reports.query`
- ✅ `GET https://youtubeanalytics.googleapis.com/v2/reports`. Obrigatórios: `ids` (`channel==MINE` ou `channel==ID`), `startDate`, `endDate` (YYYY-MM-DD) e `metrics`. Opcionais: `dimensions`, `filters` (por ex. `video==ID1,ID2`, até 500 IDs), `sort`, `maxResults`, `startIndex`, `currency`. [reports.query](https://developers.google.com/youtube/analytics/reference/reports/query)
- ✅ **Latência**: "Data processing typically introduces a latency of 48 to 72 hours". O `endDate` fica limitado ao último dia totalmente processado. Para números em tempo real, a recomendação oficial é usar `videos.list`. [Data model](https://developers.google.com/youtube/analytics/data_model)
- ✅ Combinações inválidas de métrica e dimensão retornam HTTP 400. Métricas monetárias exigem o escopo monetary e YPP; caso contrário, 403 (adicionado em 09/09/2026). [Analytics revision history](https://developers.google.com/youtube/analytics/revision_history)
- ✅ Consultas de traffic source retornam erro quando vídeos × dias passa de 50.000 (desde 18/11/2024). [Analytics revision history](https://developers.google.com/youtube/analytics/revision_history)

### 11.2 Métricas úteis
Fonte: [Metrics](https://developers.google.com/youtube/analytics/metrics) ✅

| Métrica | Definição resumida |
|---|---|
| `views` | O significado varia conforme o tipo de relatório. Para Shorts, desde 31/03/2025 cada início ou replay conta, sem tempo mínimo. Desde 27/08/2026 todos os formatos contam a partir do primeiro frame. |
| `engagedViews` | Mantém o método antigo de contagem (views "engajadas"). Disponível desde 30/04/2025 nas Targeted Queries. **A monetização e as métricas "core" continuam atreladas a engaged views.** |
| `likes`, `dislikes`, `comments`, `shares` | Contagens de interação |
| `subscribersGained` / `subscribersLost` | Com filtro de vídeo, contam só a página de exibição daquele vídeo |
| `estimatedMinutesWatched` | Minutos assistidos |
| `averageViewDuration` | Segundos médios por reprodução. **Exclui tráfego de clipes em loop** desde 13/12/2021. |
| `averageViewPercentage` | % médio assistido (também exclui loops) |
| `audienceWatchRatio` | Retenção num ponto do vídeo (pode passar de 1 com rewatch). Usar com a dimensão `elapsedVideoTimeRatio`. |
| `relativeRetentionPerformance` | 0–1, comparado com vídeos de duração parecida. Usar com `elapsedVideoTimeRatio`. |
| `videosAddedToPlaylists` | Adições a playlists |
| `video_thumbnail_impressions`, `video_thumbnail_impressions_ctr` | Adicionadas em 15/01/2026 nos reach reports. ❓ Confirmar se estão nas Targeted Queries ou só na Reporting API ([Analytics revision history](https://developers.google.com/youtube/analytics/revision_history)). |

Fontes das datas de `views`/`engagedViews`: [Analytics revision history](https://developers.google.com/youtube/analytics/revision_history), [Data API revision history](https://developers.google.com/youtube/v3/revision_history) ✅

### 11.3 Dimensões úteis
Fonte: [Dimensions](https://developers.google.com/youtube/analytics/dimensions) ✅
- `video`, `day`, `country`, `deviceType`, `subscribedStatus`, `ageGroup`, `gender`
- `elapsedVideoTimeRatio`: 100 pontos de 0,01 a 1,0 (curva de retenção)
- `creatorContentType`: `SHORTS`, `VIDEO_ON_DEMAND`, `LIVE_STREAM`, `STORY`, `UNSPECIFIED`. Serve para separar Shorts de longos.
- `insightTrafficSourceType`: inclui `SHORTS` (swipe no feed de Shorts), `HASHTAGS`, `SOUND_PAGE`, `VIDEO_REMIXES`
- `insightPlaybackLocationType`: inclui `SHORTS_FEED`

❓ As combinações permitidas (por ex. `elapsedVideoTimeRatio` + filtro de um único vídeo) estão nas páginas de "channel reports". Validar antes de implementar.

### 11.4 Data API: `videos.list` (statistics)
- ✅ `statistics.viewCount`, `likeCount` e `commentCount` são públicos. `dislikeCount` só vem com autenticação do dono. `favoriteCount` está depreciado (sempre 0). Custo de 1 unidade. Quase em tempo real (recomendação oficial para dados "real-time"). [videos resource](https://developers.google.com/youtube/v3/docs/videos), [Data model](https://developers.google.com/youtube/analytics/data_model)
- ✅ Alternativa: `videos.batchGetStats`, com bucket próprio (ver 10.1).

### 11.5 YouTube Reporting API (bulk)
Fonte: [Reporting API](https://developers.google.com/youtube/reporting/v1/reports) ✅
- Cria-se um **job** por tipo de relatório (por ex. `channel_basic_a3`) e o YouTube passa a gerar CSVs **diários** (dia no horário do Pacífico).
- O primeiro relatório sai cerca de 2 dias depois. Ao criar o job, são gerados **30 dias de histórico** (backfill).
- Retenção: **60 dias** (relatórios históricos: 30 dias). Baixar e guardar do nosso lado.
- Escopos: `yt-analytics.readonly` (ou monetary).
- **Uso sugerido:** Analytics API para consultas pontuais e o painel; Reporting API como ingestão diária em massa quando houver vários canais. A coluna `engaged_views` existe nos relatórios bulk desde 30/06/2025 ([Analytics revision history](https://developers.google.com/youtube/analytics/revision_history)).

---

## 12. Políticas relevantes

| Política | Pontos-chave | Fonte |
|---|---|---|
| **YPP: Reused content** ✅ | Reaproveitar conteúdo já disponível sem comentário original significativo, modificação substancial ou valor educativo/de entretenimento tira a monetização **do canal inteiro**, mesmo com permissão do autor e mesmo sem claim de copyright. Proibido: compilações sem narrativa, vídeos curtos compilados de outras redes, edições mínimas. Permitido: conteúdo editado com narrativa e comentário, ou conteúdo que mostra principalmente você. | [Ajuda: políticas de monetização](https://support.google.com/youtube/answer/1311392) |
| **YPP: Inauthentic content** ✅ | Política renomeada em 15/07/2025 (antes "repetitious"). Proibido: conteúdo em massa ou templateado e conteúdo de IA genérico sem insight original. Permitido: intros/outros compartilhadas se o conteúdo principal muda. | idem |
| **Conteúdo sintético (A/S)** ✅ | Divulgar quando o conteúdo é realista e alterado ou gerado. **Gameplay de jogos não exige divulgação**, nem títulos, roteiros ou thumbnails feitos com IA. Não divulgar repetidamente pode gerar label manual, remoção ou suspensão do YPP. Divulgar não reduz alcance nem monetização. O YouTube pode rotular automaticamente (C2PA, detecção). Na API: `status.containsSyntheticMedia`. | [Ajuda: conteúdo sintético](https://support.google.com/youtube/answer/14328491), [videos resource](https://developers.google.com/youtube/v3/docs/videos) |
| **Spam / clickbait** ✅ | Proibidos títulos, thumbnails e descrições maliciosamente enganosos, produção em massa de conteúdo quase idêntico com ferramentas automatizadas e incentivo a engajamento em troca de recompensa. | [Ajuda: spam](https://support.google.com/youtube/answer/2801973) |
| **Hashtags** ✅ | Mais de 60 → todas ignoradas. Não usar hashtags não relacionadas. | [Ajuda: hashtags](https://support.google.com/youtube/answer/6390658) |
| **Música / Content ID em Shorts** ✅/❓ | Shorts > 1 min com claim ativo podem ser bloqueados globalmente (seção 6). Limite de 90/60/30 s para músicas da biblioteca. | [Ajuda: Shorts de 3 min](https://support.google.com/youtube/answer/15424877?hl=en-GB) |
| **Rejeição na API** ✅ | `rejectionReason` pode ser `duplicate`, `copyright`, `claim`, `inappropriate`, `termsOfUse` etc. | [videos resource](https://developers.google.com/youtube/v3/docs/videos) |

**Impacto no produto:** gerar várias versões do mesmo vídeo para o **mesmo** canal do YouTube pode esbarrar em `duplicate` e "inauthentic content". A estratégia por plataforma deve ser: uma versão por plataforma, não várias no YouTube. Como o conteúdo é original do criador (gameplay próprio), o risco de "reused" é baixo, mas cortes de streams de terceiros seriam arriscados.

---

## 13. Idempotência e erros comuns

### 13.1 Evitar upload duplicado
- ❓ **A API não oferece chave de idempotência** em `videos.insert` (nenhum parâmetro do tipo aparece na página do método). Portanto a idempotência tem que ser **nossa**:
  1. Máquina de estados por publicação (`pending → session_created → uploading → uploaded(video_id) → processing → scheduled/published`).
  2. **Persistir a session URI** antes de enviar bytes. Num retry, consultar o status da sessão (`PUT` vazio com `Content-Range: bytes */TOTAL`) em vez de abrir sessão nova. [Resumable upload](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
  3. Persistir o `video.id` assim que vier o `201`. Se a resposta se perder (timeout depois do envio completo), o status da sessão deve indicar a conclusão. ❓ Validar o comportamento.
  4. Em último caso, reconciliar listando os uploads recentes do canal (playlist de uploads via `playlistItems.list`/`videos.list`) e comparando título e horário. ❓ Técnica nossa, não documentada como padrão.
- ✅ O YouTube pode rejeitar duplicatas (`rejectionReason=duplicate`). Não dá para confiar nisso como deduplicação. [videos resource](https://developers.google.com/youtube/v3/docs/videos)

### 13.2 Retomar upload resumable
- ✅ Status com `308` + header `Range` (bytes recebidos). Sem `Range`, nada foi recebido. Respeitar `Retry-After`. Reenviar a partir do byte seguinte; lacunas ou sobreposição fazem com que nada seja gravado. [Resumable upload](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
- ✅ `404` na session URI significa sessão expirada: recomeçar do zero. A sessão "has a finite lifetime" e **a duração não é documentada** (❓).
- ✅ Retry em 500/502/503/504 e em quedas de conexão, com **backoff exponencial com jitter** (o exemplo oficial usa até 10 tentativas, com espera aleatória de até 2^n s). Outros 4xx/5xx são falhas permanentes. [Uploading a video](https://developers.google.com/youtube/v3/guides/uploading_a_video), [Resumable upload](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)

### 13.3 Erros relevantes
| Erro | HTTP | Significado / ação | Fonte |
|---|---|---|---|
| `quotaExceeded` | 403 | Cota do projeto esgotada. Não adianta retry; reagendar para depois do reset (meia-noite PT). | [Errors](https://developers.google.com/youtube/v3/docs/errors) |
| `uploadLimitExceeded` | 400 | Limite diário de uploads **do canal**, independente da cota | [Errors](https://developers.google.com/youtube/v3/docs/errors), [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| `forbidden` | 403 | Autorização insuficiente | idem |
| `forbiddenPrivacySetting`, `forbiddenLicenseSetting` | 403 | Configuração de privacidade ou licença não permitida | [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| `invalidPublishAt` | 400 | `publishAt` inválido | idem |
| `invalidTitle` / `invalidDescription` / `invalidTags` / `invalidCategoryId` / `defaultLanguageNotSet` | 400 | Validação de metadados | idem |
| `mediaBodyRequired` | 400 | Faltou o binário | idem |
| `uploadRateLimitExceeded` | 429 | Muitas thumbnails em pouco tempo (`thumbnails.set`) | [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set) |
| `invalid_grant` (OAuth) | — | Refresh token expirado ou revogado. Marcar o canal como "reconectar". | [Server-side web apps](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps) |

---

## 14. Notificações (PubSubHubbub / WebSub)

- ✅ Hub: `https://pubsubhubbub.appspot.com`. Tópico: `https://www.youtube.com/xml/feeds/videos.xml?channel_id=CHANNEL_ID`. [Push notifications](https://developers.google.com/youtube/v3/guides/push_notifications)
- ✅ Eventos: **upload de vídeo, mudança de título, mudança de descrição**. Payload Atom com `yt:videoId` e `yt:channelId`. [Push notifications](https://developers.google.com/youtube/v3/guides/push_notifications)
- ❓ A página não fala de exclusão, lease ou renovação. Pela especificação WebSub a assinatura tem lease e precisa ser renovada, mas isso não foi confirmado na doc do YouTube.
- **Relevância:** baixa para o MVP. Como somos nós que fazemos o upload, já sabemos o `video_id`. Pode ser útil para detectar uploads feitos fora da central (direto no Studio) e importá-los para o painel de métricas. Exige um endpoint público de callback.

---

## 15. Tabela final

| Item | Status | Fonte |
|---|---|---|
| Upload via `videos.insert`, resumable, até 256 GB | ✅ | [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| Escopos do Data API, Analytics e Reporting (lista) | ✅ | [Scopes](https://developers.google.com/identity/protocols/oauth2/scopes) |
| `reports.query` exige `youtube.readonly`? (doc inconsistente) | ❓ | [reports.query](https://developers.google.com/youtube/analytics/reference/reports/query) |
| Refresh token de 7 dias em "Testing" (External) | ✅ | [OAuth2](https://developers.google.com/identity/protocols/oauth2) |
| Limite de 100 refresh tokens por conta e client | ✅ | [OAuth2](https://developers.google.com/identity/protocols/oauth2) |
| Verificação OAuth dispensada para uso pessoal (< 100 usuários) ou Internal | ✅ | [Cloud 13464323](https://support.google.com/cloud/answer/13464323) |
| "In production" sem verificação evita expiração em 7 dias | ❓ | inferência a partir de [OAuth2](https://developers.google.com/identity/protocols/oauth2) |
| Classificação sensível/restrito dos escopos YouTube | ❓ | não encontrado |
| Restrição a privado para projeto não verificado: **revogada em 02/11/2026** | ✅ | [Revision history](https://developers.google.com/youtube/v3/revision_history) |
| Aumento de cota exige auditoria | 🔒 | [Quota & audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits) |
| Cota: 100 inserts/dia, 100 search/dia, 10.000 unidades nos demais | ✅ | [Quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost) |
| `thumbnails.set` e `videos.update` custam 50 | ✅ | idem |
| Limite diário de uploads por canal (número) | ❓ | [Errors](https://developers.google.com/youtube/v3/docs/errors) (sem número) |
| Shorts = quadrado/vertical e ≤ 3 min (desde 15/10/2024) | ✅ | [Ajuda 15424877](https://support.google.com/youtube/answer/15424877) |
| Sem flag de Short na API | ✅ (por ausência) | [videos resource](https://developers.google.com/youtube/v3/docs/videos) |
| `#Shorts` necessário para classificar | ❓ (não documentado) | [Ajuda 6390658](https://support.google.com/youtube/answer/6390658) |
| Shorts até 1080p | ✅ | [Ajuda 10059070](https://support.google.com/youtube/answer/10059070) |
| Thumbnail customizada em Shorts via API (desde 03/11/2026) | ✅ | [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set) |
| Thumbnail até 50 MB | ✅ | [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set) |
| `publishAt` exige `private` e vídeo nunca publicado | ✅ | [videos resource](https://developers.google.com/youtube/v3/docs/videos) |
| Antecedência máxima do `publishAt` | ❓ | não documentado |
| `containsSyntheticMedia` (nome exato) | ✅ | [videos resource](https://developers.google.com/youtube/v3/docs/videos) |
| Gameplay não exige divulgação de IA | ✅ | [Ajuda 14328491](https://support.google.com/youtube/answer/14328491) |
| `notifySubscribers` (padrão true) | ✅ | [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| Título 100 caracteres / descrição 5.000 bytes / tags 500 caracteres | ✅ | [videos resource](https://developers.google.com/youtube/v3/docs/videos) |
| Mais de 60 hashtags → todas ignoradas | ✅ | [Ajuda 6390658](https://support.google.com/youtube/answer/6390658) |
| Especificações de codificação (MP4/H.264/AAC 48 kHz, 1080p 8/12 Mbps) | ✅ | [Ajuda 1722171](https://support.google.com/youtube/answer/1722171) |
| Vídeos > 15 min exigem conta verificada; máx. 12 h | ✅ | [Ajuda 71673](https://support.google.com/youtube/answer/71673) |
| Latência do Analytics de 48–72 h | ✅ | [Data model](https://developers.google.com/youtube/analytics/data_model) |
| `engagedViews`, `creatorContentType=SHORTS`, `elapsedVideoTimeRatio` | ✅ | [Metrics](https://developers.google.com/youtube/analytics/metrics), [Dimensions](https://developers.google.com/youtube/analytics/dimensions) |
| Custo de cota da Analytics API | ❓ | não documentado na página |
| Reporting API: backfill de 30 dias, retenção de 60 dias | ✅ | [Reporting API](https://developers.google.com/youtube/reporting/v1/reports) |
| Content ID: Short > 1 min com claim bloqueado globalmente | ✅ (texto atual) / ❓ (possível mudança em 09/2026) | [Ajuda 15424877 en-GB](https://support.google.com/youtube/answer/15424877?hl=en-GB) |
| Sem chave de idempotência no insert | ❓ (por ausência) | [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| Duração da session URI do resumable | ❓ | [Resumable upload](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol) |
| Dados autorizados: atualizar ou apagar em 30 dias; revogação → apagar em 7 dias | ✅ | [Developer Policies](https://developers.google.com/youtube/terms/developer-policies) |
| Um projeto de API por API Client | ✅ | [Developer Policies](https://developers.google.com/youtube/terms/developer-policies) |
| WebSub: upload/título/descrição | ✅ | [Push notifications](https://developers.google.com/youtube/v3/guides/push_notifications) |
| WebSub: lease/renovação/exclusão | ❓ | não documentado na página |

---

## 16. Fontes

**YouTube Data API v3**
- https://developers.google.com/youtube/v3/docs/videos/insert
- https://developers.google.com/youtube/v3/docs/videos
- https://developers.google.com/youtube/v3/docs/thumbnails/set
- https://developers.google.com/youtube/v3/docs/thumbnails
- https://developers.google.com/youtube/v3/docs/errors
- https://developers.google.com/youtube/v3/determine_quota_cost
- https://developers.google.com/youtube/v3/getting-started
- https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- https://developers.google.com/youtube/v3/guides/uploading_a_video
- https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps
- https://developers.google.com/youtube/v3/guides/push_notifications
- https://developers.google.com/youtube/v3/revision_history (lida até ~100k caracteres, o que cobre 2024–2026)
- https://developers.google.com/youtube/terms/developer-policies

**YouTube Analytics / Reporting**
- https://developers.google.com/youtube/analytics/reference/reports/query
- https://developers.google.com/youtube/analytics/metrics
- https://developers.google.com/youtube/analytics/dimensions
- https://developers.google.com/youtube/analytics/data_model
- https://developers.google.com/youtube/analytics/revision_history
- https://developers.google.com/youtube/reporting/v1/reports

**Google Identity / Cloud**
- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/identity/protocols/oauth2/scopes
- https://support.google.com/cloud/answer/13463073
- https://support.google.com/cloud/answer/13464323

**Central de Ajuda do YouTube**
- https://support.google.com/youtube/answer/15424877 (Shorts de 3 minutos; versão en-GB consultada para Content ID)
- https://support.google.com/youtube/answer/10059070 (upload de Shorts)
- https://support.google.com/youtube/answer/1722171 (codificação recomendada)
- https://support.google.com/youtube/answer/71673 (vídeos > 15 min)
- https://support.google.com/youtube/answer/6390658 (hashtags)
- https://support.google.com/youtube/answer/14328491 (conteúdo alterado/sintético)
- https://support.google.com/youtube/answer/1311392 (políticas de monetização do YPP)
- https://support.google.com/youtube/answer/2801973 (spam e práticas enganosas)
- Formulários: https://support.google.com/youtube/contact/yt_api_form · https://support.google.com/youtube/contact/yt_api_appeals
