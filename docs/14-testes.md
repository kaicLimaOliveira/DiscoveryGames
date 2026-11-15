# 14 — Estratégia de testes

## 1. Pirâmide

| Nível | Ferramenta | O que cobre | Quando roda |
|---|---|---|---|
| Unitário | Vitest | State machines, decisão de estratégia de mídia, validadores de copy, classificação de erros dos adaptadores, cálculo de custo, conversões de timezone, cifragem | Todo push |
| Integração | Vitest + Testcontainers (Postgres, MinIO) | Repositórios, transações estado+fila, pg-boss, fluxo de publicação com HTTP simulado, pipeline FFmpeg real com vídeos de amostra | Todo push |
| Contrato de adaptador | Vitest + fixtures gravadas | Cada adaptador contra respostas reais anonimizadas (sucesso, erros, rate limit, token expirado) | Todo push |
| E2E | Playwright | Upload → revisão → aprovação → publicar (com adaptadores *fake*) → ver resultado; agendamento; calendário | PR para `main` |
| Sandbox real (manual/semiautomático) | Script + contas de teste | Publicação real em contas de teste/privadas de cada plataforma | Antes de concluir cada fase de integração e trimestralmente |
| Avaliação de IA | Script de eval | Conjunto golden de prompts | A cada mudança de prompt/modelo |

## 2. Casos obrigatórios por área

### 2.1 Idempotência e concorrência de publicação (críticos)

| Caso | Esperado |
|---|---|
| Dois workers recebem o mesmo job | Só um adquire o lock; o outro termina sem chamada externa |
| Worker morre após criar container/sessão e antes de publicar | Retomada usa o `progress` salvo; nenhuma segunda criação |
| Timeout na chamada de publicar, mas a plataforma publicou | `unknown` → reconciliação encontra o post → `published`; 0 duplicatas |
| Timeout e a plataforma **não** publicou | Reconciliação → `retry_wait` → nova tentativa → 1 post |
| 429 com `Retry-After` | Espera respeitada; contagem de tentativas correta |
| Token expirado no meio | Renovação + retomada; se a renovação falhar → `needs_attention` + conta `needs_reauth` |
| Erro permanente (vídeo rejeitado) | `needs_attention` sem retry automático |
| Edição de texto após aprovação | Aprovação invalidada; job agendado não publica |
| Pausa global ativa | Nenhuma publicação inicia |

Técnica: *fault injection* no cliente HTTP simulado (falhar no passo N, atrasar resposta, devolver sucesso após timeout) e testes de "matar o processo" com reinício.

### 2.2 Agendamento

Os cenários de [11 §6](11-agendamento.md), com relógio controlado (fake timers ou `now()` injetável no `core`), mais: mudança de horário de verão hipotética (zona com DST em teste), agendamentos vencidos além de `lateThreshold`.

### 2.3 Pipeline de mídia

Biblioteca de amostras de [10 §11](10-pipeline-audiovisual.md). Para cada uma: estratégia escolhida, saída validada com ffprobe contra as constraints de cada plataforma, original intacto (hash igual antes/depois).

### 2.4 IA

- Unitários com `LlmProvider` *fake* devolvendo JSON fixo/inválido/recusa.
- Validador de copy: limites de caracteres (incluindo emojis e acentos — medir como cada plataforma mede), nº de hashtags, termos proibidos, padrões de fato sem fonte.
- Eval golden (20–30 casos reais): % aprovado sem edição ≥ 70% como meta inicial; 0 fatos inventados nos casos com armadilha (contexto sem data → texto não pode conter data).

### 2.5 Segurança

- Rotas protegidas por papel (testes de autorização negativos para cada rota mutável).
- OAuth: callback com `state` inválido → rejeitado.
- Logs: teste que garante que tokens/segredos de exemplo não aparecem na saída do logger.
- Cifragem: round-trip, rotação de chave, IV único.

## 3. Fixtures das plataformas

- Gravadas em ambiente de teste com contas próprias, **anonimizadas** (IDs trocados, tokens removidos) e versionadas em `packages/platforms/<plataforma>/__fixtures__/`.
- Cada fixture registra data e versão da API; quando a plataforma mudar, regravar e ajustar o adaptador (o teste de contrato quebra primeiro, não a produção).

## 4. Ambientes

| Ambiente | Banco | Storage | Plataformas | IA |
|---|---|---|---|---|
| Local | Postgres em Docker | MinIO | Adaptadores *fake* (padrão) ou contas de teste | *Fake* ou chave real com orçamento baixo |
| CI | Testcontainers | MinIO (Testcontainers) | Fixtures | *Fake* |
| Staging (opcional) | Postgres separado na mesma VPS | Bucket separado | Contas de teste/privadas | Real com orçamento baixo |
| Produção | Postgres | R2 | Contas reais | Real |

O **adaptador fake** (`platform: 'fake'`) implementa `PlatformAdapter` simulando latência, falhas configuráveis e reconciliação — é o que permite desenvolver painel e fluxos antes das aprovações das plataformas.

## 5. Critérios de qualidade no CI

- Lint, typecheck sem erros.
- Testes verdes.
- Cobertura ≥ 80% em `core`, `media` (lógica de decisão), `platforms` (adaptadores) e validadores de `ai`.
- Migrações aplicáveis em banco vazio e sobre a versão anterior.
