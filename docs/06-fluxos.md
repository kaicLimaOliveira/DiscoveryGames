# 06 — Fluxos de processamento

## 1. Fluxo ponta a ponta

```mermaid
flowchart TD
    A[Upload do original<br/>direto ao R2] --> B[Registrar MediaAsset original<br/>+ SHA-256]
    B --> C{Duplicado na marca?}
    C -- sim --> C1[Alerta DUPLICATE_UPLOAD<br/>usuário decide]
    C -- não --> D
    C1 --> D[ffprobe + validação técnica]
    D -->|inválido| X[Content = failed<br/>motivo exibido]
    D -->|ok| E[Para cada plataforma selecionada:<br/>escolher preset e estratégia]
    E --> F[Renditions<br/>passthrough / remux / transcode]
    F --> G[Validar rendition × constraints da plataforma]
    D --> H[Extrair áudio → transcrição]
    D --> H2[Amostrar quadros]
    H --> I[IA: análise de conteúdo]
    H2 --> I
    H2 --> W[IA visão: varredura de marca d'água]
    I --> J{Notícia ou afirmações factuais?}
    J -- sim --> K[IA + web search: fact-check com fontes]
    J -- não --> L
    K --> L[IA: textos por plataforma<br/>validação determinística de limites]
    G --> M[Regras de compliance]
    W --> M
    L --> M
    M --> N[Content = ready_for_review<br/>Publications = pending_approval]
    N --> O{Aprovação por plataforma}
    O -- alterações --> L2[Editar manualmente ou<br/>regenerar com instrução] --> O
    O -- rejeitar --> R[Publication = rejected]
    O -- aprovar --> P{Quando?}
    P -- agora --> Q[Enfileirar publish]
    P -- agendado --> S[Publication = scheduled]
    S -->|scheduler tick no horário| Q
    Q --> T[Adaptador da plataforma<br/>preflight → upload → publicar → confirmar]
    T -->|ok| U[published + externalId/URL]
    T -->|transitório| V[retry com backoff]
    T -->|permanente| Y[needs_attention]
    T -->|incerto| Z[unknown → reconciliar]
    U --> MET[Coleta de métricas 1h · 6h · 24h · 72h · 7d · 28d]
```

As etapas de mídia (ramo da esquerda) e de IA (ramo da direita) rodam **em paralelo** depois do ffprobe; o conteúdo só fica `ready_for_review` quando ambas terminam.

## 2. State machine do `Content`

```mermaid
stateDiagram-v2
    [*] --> draft: metadados criados
    draft --> uploaded: upload confirmado
    uploaded --> processing: probe/validação iniciada
    processing --> failed: arquivo inválido / erro permanente
    processing --> ready_for_review: renditions + textos + compliance prontos
    failed --> processing: reprocessar (manual)
    ready_for_review --> processing: reprocessar (ex.: novo preset)
    ready_for_review --> distributing: ≥1 publicação aprovada
    distributing --> completed: todas as publicações em estado final
    completed --> distributing: nova publicação adicionada
    draft --> archived
    ready_for_review --> archived
    completed --> archived
```

`Content.status` é parcialmente **derivado** dos estados das publicações (`distributing`/`completed`); o `core` recalcula após cada transição de `Publication`.

## 3. State machine da `Publication` (a mais crítica)

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> pending_approval: textos + rendition prontos
    pending_approval --> changes_requested: aprovador pede alteração
    changes_requested --> pending_approval: nova versão de texto/vídeo
    pending_approval --> rejected
    pending_approval --> approved: aprovação registrada
    approved --> pending_approval: edição após aprovação (invalida)
    approved --> queued: publicar agora
    approved --> scheduled: agendar (manual) / alocador da grade (auto)
    scheduled --> approved: realocação da fila (só auto, fora do congelamento de 60 min)
    scheduled --> paused: pausar
    paused --> scheduled: retomar
    scheduled --> queued: tick no horário (pré-checagens ok)
    scheduled --> canceled
    paused --> canceled
    approved --> canceled
    queued --> publishing: worker adquire lock
    publishing --> published: confirmado na plataforma
    publishing --> retry_wait: erro transitório
    retry_wait --> publishing: backoff expirou
    publishing --> needs_attention: erro permanente / auth / política / tentativas esgotadas
    publishing --> unknown: resultado incerto
    unknown --> published: reconciliação encontrou o post
    unknown --> retry_wait: reconciliação confirmou que não existe
    unknown --> needs_attention: reconciliação inconclusiva
    needs_attention --> queued: retentar manualmente (após correção)
    needs_attention --> canceled
    queued --> awaiting_manual_post: mode = manual (notifica responsável)
    awaiting_manual_post --> published: URL do post colada e validada
    awaiting_manual_post --> canceled
    needs_attention --> awaiting_manual_post: trocar para modo manual
    published --> [*]
    canceled --> [*]
    rejected --> [*]
```

Regras invariantes:

1. Só `approved`/`scheduled`/`needs_attention` podem ir para `queued`, e só se existir `Approval` vigente cujo `copyVersionId` = `currentCopyVersionId` e `assetId` = `renditionAssetId`.
2. A transição `queued → publishing` é um `UPDATE ... SET status='publishing', lockedBy=?, lockedAt=now() WHERE id=? AND status='queued'` — se 0 linhas, outro worker já pegou; o job termina sem efeito.
3. `published` é terminal e imutável (exceto métricas).
4. `unknown` **nunca** volta direto a `publishing` sem reconciliação.
5. Lock expirado (`lockedAt` > 15 min sem heartbeat) → job `maintenance` move para `unknown` (não para `queued`), forçando reconciliação.

## 4. Fluxo de publicação (genérico, por adaptador)

```mermaid
sequenceDiagram
    autonumber
    participant J as Job publish
    participant C as core
    participant DB as PostgreSQL
    participant AD as PlatformAdapter
    participant P as Plataforma

    J->>C: publish(publicationId)
    C->>DB: UPDATE status queued→publishing (lock)
    alt lock não obtido
        C-->>J: encerra (idempotente)
    end
    C->>AD: preflight(conta, rendition, copy)
    AD->>P: verifica token/cota/capacidades
    AD-->>C: ok | AuthError | QuotaError
    loop passos do adaptador (retomáveis)
        C->>DB: lê progress (IDs intermediários)
        C->>AD: step(progress)
        AD->>P: chamada HTTP
        P-->>AD: resposta
        AD-->>C: novo progress | erro classificado
        C->>DB: grava progress + PublishAttempt (antes do próximo passo)
    end
    AD-->>C: externalId, externalUrl
    C->>DB: status=published, publishedAt, externalId (transação)
    C->>DB: agenda coleta de métricas
```

Exemplo concreto de passos (detalhes oficiais em `07-integracoes/`):

| Plataforma | Passos persistidos em `progress` |
|---|---|
| Instagram Reels | criar container → (aguardar processamento do container) → publicar container → obter permalink |
| Facebook Reels | iniciar sessão de upload → enviar bytes → finalizar/publicar → aguardar status |
| TikTok (manual assistido) | `awaiting_manual_post` → notificação no horário → pessoa baixa vídeo e copia texto → posta no app → cola URL → validação do formato da URL → `published` |
| YouTube | criar sessão resumable (URI) → enviar bytes (retomável por offset) → receber `videoId` → (opcional) thumbnail |

Se o worker morrer no meio, o próximo job lê `progress` e **continua do último passo concluído** (ex.: não cria um segundo container do Instagram se já existe um válido; retoma o upload resumable do YouTube pelo offset).

## 5. Fluxo de reconciliação (resultado incerto)

```mermaid
flowchart TD
    A[Publication = unknown] --> B{Adaptador tem ID que identifica o post?<br/>ex.: videoId do YouTube, media id do IG}
    B -- sim --> C[Consultar status do objeto na plataforma]
    C -->|publicado| OK[published]
    C -->|não existe / falhou| RT[retry_wait]
    B -- não --> D[Listar posts recentes da conta<br/>janela: lockedAt − 5 min … agora + 30 min]
    D --> E{Algum post bate?<br/>marcador da legenda + duração ± 1 s + horário}
    E -- exatamente 1 --> OK
    E -- nenhum --> F{Plataforma confirmou falha<br/>ou passou janela de processamento?}
    F -- sim --> RT
    F -- não --> W[aguardar e reconsultar<br/>até 3 vezes]
    W --> D
    E -- mais de 1 --> NA[needs_attention<br/>revisão humana]
```

O "marcador" é um identificador **não visível**: preferencialmente um campo da própria plataforma que aceite referência externa, quando existir; caso contrário, a correspondência usa legenda exata + duração + janela de tempo. Não inserir caracteres invisíveis na legenda (pode ser interpretado como manipulação).

## 6. Fluxo de geração e revisão de textos

```mermaid
sequenceDiagram
    autonumber
    participant K as worker
    participant AI as Claude
    participant V as Validador determinístico
    participant DB as PostgreSQL
    actor A as Aprovador

    K->>AI: generate_copy(análise, fatos verificados, voz da marca, regras por plataforma)
    AI-->>K: JSON {instagram, facebook, tiktok, youtube}
    K->>V: validar limites e regras por plataforma
    alt violação
        K->>AI: corrigir apenas os campos violados (1 tentativa)
        AI-->>K: JSON corrigido
        K->>V: revalidar
    end
    K->>DB: CopyVersion v1 (source=ai) por Publication
    A->>DB: edita (CopyVersion v2, source=human)
    A->>K: "regenerar TikTok: mais curto, tom de humor"
    K->>AI: regenerate_copy(plataforma, versão atual, instrução)
    AI-->>K: JSON
    K->>DB: CopyVersion v3 (source=ai_regenerated)
```

## 7. Fluxo de conexão de conta (OAuth genérico)

```mermaid
sequenceDiagram
    autonumber
    actor Ad as Admin
    participant W as web
    participant P as Provedor OAuth
    participant DB as PostgreSQL

    Ad->>W: Conectar conta (plataforma X, marca Y)
    W->>W: gera state (+ code_verifier PKCE quando suportado), salva em cookie selado
    W-->>Ad: redirect para URL de autorização (escopos mínimos)
    Ad->>P: login + consentimento
    P-->>W: callback ?code&state
    W->>W: valida state
    W->>P: troca code por tokens
    W->>P: busca identidade (conta/página/canal) e escopos concedidos
    W->>DB: SocialAccount + OAuthCredential (cifrado) + AuditLog
    W-->>Ad: conta conectada (ou lista de páginas/contas para escolher)
```

## 8. Fluxo de coleta de métricas

```mermaid
flowchart LR
    P[Publication published] --> S[Agendar coletas:<br/>+1h, +6h, +24h, +72h, +7d, +28d]
    S --> C[collect-metrics]
    C --> A[Adaptador.fetchMetrics]
    A --> N[Normalizar → colunas comuns<br/>nulo quando indisponível]
    N --> DB[(MetricSnapshot)]
    DB --> D[Dashboard e comparativos]
    DB --> WI[weekly-insights<br/>Batch API]
```

Após 28 dias: coleta semanal até 90 dias, depois mensal (configurável). Respeita limites de taxa de cada plataforma (fila `metrics` com concorrência baixa).
