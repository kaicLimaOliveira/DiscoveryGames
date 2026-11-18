# 09 — Estratégia de IA e "agentes"

## 1. Decisão: tarefas pontuais, não agentes autônomos

O briefing sugeriu seis agentes (Content Analyst, Content Strategist, Copywriter, Video Processing, Publishing, Analytics). Avaliação:

| Papel sugerido | Precisa de LLM? | Precisa de autonomia (loop com ferramentas)? | Implementação decidida |
|---|---|---|---|
| Content Analyst | Sim (entender contexto, transcrição, quadros) | Não — entrada e saída bem definidas | **Tarefa `analyze`**: 1 chamada, saída JSON estruturada |
| Content Strategist | Parcialmente | Não | Absorvido por `analyze` (recomendações) e `weekly-insights` |
| Copywriter | Sim | Não | **Tarefa `generate_copy`** (1 chamada para as 4 redes) + `regenerate_copy` |
| Video Processing Agent | **Não** | Não | **Serviço determinístico** (`media`): regras + FFmpeg. LLM aqui só adicionaria custo e imprevisibilidade |
| Publishing Agent | **Não** | Não | **Serviço determinístico** (`platforms` + state machine). Publicar é exatamente onde não se quer não-determinismo |
| Analytics Agent | Sim, para síntese | Não | **Tarefa `weekly-insights`** via Batch API (50% mais barata), sobre dados já agregados por SQL |

Única tarefa com uso de ferramenta: **`fact_check`**, que usa a ferramenta de *web search* do servidor da Anthropic dentro de uma única requisição (o loop roda no servidor da Anthropic, não precisamos operar um agente).

**Por quê:** cada passo tem entradas e saídas conhecidas; agentes autônomos aumentariam custo de tokens, latência, superfície de erro e dificuldade de teste, sem ganho real. Os "agentes" sobrevivem como **papéis** — cada um é um prompt versionado com schema de saída. Se no futuro surgir uma tarefa aberta (ex.: "pesquise tendências da semana e proponha pautas"), ela pode virar um agente sem afetar o restante.

## 2. Provedor e modelos

| Item | Decisão | Motivo |
|---|---|---|
| Provedor principal | Anthropic Claude (Messages API, SDK oficial `@anthropic-ai/sdk`) | Saída estruturada por JSON Schema, visão (quadros do vídeo), web search no servidor com citações, prompt caching, Batch API |
| Abstração | Interface `LlmProvider` no pacote `ai` (métodos: `generateStructured`, `generateWithWebSearch`, `submitBatch`) | Trocar de provedor ou modelo por configuração; facilita mocks em teste |
| Modelo padrão | `claude-opus-5-5` com `effort: low` ou `medium` por tarefa | Qualidade de texto e de julgamento factual; custo por vídeo fica em centavos no volume previsto (ver [15](15-custos.md)) |
| Modelo econômico | `claude-haiku-5-5` para tarefas simples (varredura de marca d'água em quadros, classificação) | Muito barato; tarefa de baixa complexidade |
| Configuração | Modelo e *effort* por tarefa ficam em `Setting` (painel), não no código | Ajuste de custo/qualidade sem deploy |

Preços de referência (Anthropic, 2026): Opus 5.5 US$ 4 / US$ 20 por milhão de tokens (entrada/saída); Haiku 5.5 US$ 0,10 / US$ 0,50; Batch API com 50% de desconto; web search US$ 10 por 1.000 buscas. Confirmar na página oficial de preços antes de fechar orçamento.

Transcrição: LLMs de texto da Anthropic não transcrevem áudio. Usa-se um serviço de transcrição dedicado atrás da interface `Transcriber` — escolha e custo em [04](04-tecnologias.md) e [15](15-custos.md).

## 3. Tarefas de IA

### 3.1 `analyze` — análise de conteúdo

- **Entrada:** título, categoria, jogo (nome + aliases do catálogo), contexto do autor, roteiro (se houver), transcrição com timestamps, 4–6 quadros amostrados (imagens reduzidas a ~768px no maior lado), duração.
- **Saída (JSON Schema):**
  - `summary` (≤ 400 caracteres)
  - `contentKind` (enum alinhado a `Category.kind`) + `confidence`
  - `games[]`, `entities[]` (personagens, eventos — somente se presentes na entrada)
  - `factualClaims[]`: `{ claim, sourceInInput: "transcript@00:12" | "context" | "script", needsVerification: bool }`
  - `tone`, `targetAudience`
  - `engagementOpportunities[]` (pergunta para comentários, gancho dos 2 primeiros segundos)
  - `publishingRecommendations[]`
  - `risks[]`: `{ code, description }` (ex.: música aparente, logo de outra rede, spoiler, conteúdo sensível)
- **Regras do prompt:** usar apenas informações da entrada; se algo não está na entrada, não afirmar; marcar incerteza explicitamente.

### 3.2 `fact_check` — verificação factual

- **Quando:** categoria com `requiresFactCheck` (notícia) **ou** `factualClaims` com `needsVerification = true`.
- **Como:** uma requisição com a ferramenta `web_search` (tipo atual `web_search_20260209`), `max_uses` limitado (padrão 5), opcionalmente `allowed_domains` com fontes confiáveis configuráveis (sites oficiais de publishers, blogs oficiais de plataformas, imprensa especializada).
- **Saída:** por afirmação: `verdict` (`confirmed` | `unverified` | `contradicted` | `opinion`), `explanation`, `sources[]` (URL + trecho citado).
- **Uso:** alimenta `ComplianceFinding UNVERIFIED_CLAIM` (aviso) ou `CONTRADICTED_CLAIM` (**bloqueante**); o aprovador vê as fontes e pode marcar como revisado. O `generate_copy` só recebe afirmações `confirmed` ou explicitamente aprovadas pelo humano.
- **Limite honesto:** a verificação reduz, mas não elimina, o risco. Notícias recentes (horas) podem não estar indexadas; nesses casos o veredito será `unverified` e a decisão é humana.

### 3.3 `generate_copy` — textos por plataforma

- **Uma única chamada** gera as quatro plataformas: contexto compartilhado (mais barato e mais consistente).
- **Entrada:** saída do `analyze`, fatos verificados, guia de voz da organização (`Organization.voiceGuide`), hashtags oficiais do jogo, regras de cada plataforma **fornecidas pelo adaptador** (limites de caracteres, nº máximo de hashtags, convenções), formatos selecionados.
- **Saída:** `{ instagram: {caption, hashtags[]}, facebook: {description, hashtags[]}, tiktok: {caption, hashtags[]}, youtube: {title, description, tags[], hashtags[]} , titleVariants[] }` — somente as plataformas selecionadas.
- **Pós-processamento determinístico:** contagem de caracteres (na unidade que cada plataforma mede: caracteres vs bytes), número de hashtags, termos proibidos da organização, ausência de menções a outras plataformas ("link na bio do TikTok" no Instagram etc.). Violação → 1 tentativa de correção focada → se persistir, salva com alerta para o humano.
- **Diretrizes por rede** (ponto de partida; o guia de voz da organização prevalece):
  - Instagram: gancho na primeira linha, CTA para comentar/salvar, hashtags no fim, poucas e relevantes.
  - Facebook: texto um pouco mais explicativo; hashtags com moderação.
  - TikTok: curto, linguagem da plataforma, hashtags de nicho + jogo.
  - YouTube Shorts: título forte e descritivo dentro do limite; descrição com contexto; hashtags relevantes.

### 3.4 `regenerate_copy`

- Escopo de **uma** plataforma; entrada = versão atual + instrução do usuário + mesmas regras. Gera nova `CopyVersion`.

### 3.5 `watermark_scan`

- Quadros amostrados (início, meio, fim, cantos ampliados) → `claude-haiku-5-5` com saída `{ detected: bool, platformGuess, confidence, frameIndex }`.
- Complementa a checagem de metadados do arquivo (tags de encoder/comentários de container que indiquem download de outra rede). É **heurística**: gera aviso, não bloqueio automático (salvo confiança alta → bloqueante com possibilidade de aceite justificado).

### 3.6 `weekly-insights`

- SQL agrega métricas por plataforma/jogo/categoria/horário → resumo numérico compacto → Batch API (custo 50%) → relatório com recomendações ("curiosidades de jogo X performam 2× melhor no TikTok às 19h"). Sempre exibir os números de base junto com a recomendação.

## 4. Engenharia de prompts e qualidade

| Prática | Detalhe |
|---|---|
| Prompts versionados | Arquivos em `packages/ai/prompts/<tarefa>/v<N>.md` + schema JSON; `promptVersion` gravado em cada `AiRun` |
| Saída estruturada | `output_config.format` com JSON Schema; validação adicional com zod |
| Sem *prefill* | Modelos atuais não aceitam prefill de resposta; usar saída estruturada |
| Prompt caching | Parte estável (instruções + regras de plataforma + guia de voz) primeiro, com `cache_control`; dados do vídeo depois |
| Cache de resultado | Mesmo `inputHash` + `promptVersion` + `model` → reaproveita `AiRun` anterior sem chamar a API |
| Recusas | Tratar `stop_reason = "refusal"` (alguns temas de jogos — violência — podem disparar classificadores); registrar e permitir edição manual. Habilitar *fallback* do servidor quando disponível |
| Avaliação | Conjunto "golden" de 20–30 vídeos reais com textos aprovados; rodar a cada mudança de prompt/modelo; métricas: % aprovado sem edição, violações de limite, alucinações detectadas |
| Telemetria | `AiRun` guarda tokens, custo, latência; dashboard de custo por tarefa |

## 5. Anti-alucinação (requisito "não inventar")

1. O prompt proíbe afirmar o que não está na entrada; datas, preços, notas, nomes de DLC só se estiverem na entrada ou no fact-check confirmado.
2. `analyze` extrai afirmações factuais explicitamente → elas são verificadas ou sinalizadas.
3. `generate_copy` recebe apenas fatos confirmados/aprovados.
4. Validador determinístico procura padrões de risco no texto gerado (datas, valores monetários, percentuais, "confirmado", "oficial", "vazou") que não aparecem na entrada → alerta `UNSOURCED_FACT_PATTERN`.
5. Aprovação humana obrigatória em toda publicação.

## 6. Controle de custos de IA

| Mecanismo | Detalhe |
|---|---|
| Orçamento mensal por organização | `Organization.aiMonthlyBudgetUsd`; alerta em 80%; em 100% bloqueia tarefas opcionais (`weekly-insights`, variações) e exige confirmação de admin para as essenciais |
| Ledger | Cada chamada grava `CostLedger` com custo calculado a partir de `usage` |
| Tamanho de entrada | Transcrição limitada (vídeos curtos já são pequenos); quadros reduzidos; sem enviar o vídeo inteiro ao LLM |
| Effort | `low` para tarefas mecânicas, `medium` para copy e fact-check |
| Batch | Tudo que não é interativo (insights, reprocessamentos em massa) vai pela Batch API |
