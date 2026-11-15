# 02 — Requisitos não funcionais

Convenção: `RNF-<área>-<nº>`. Os números são metas iniciais para o volume previsto (1–3 vídeos/dia, 1 marca, até ~5 usuários) e devem ser revistos quando houver várias marcas.

## 1. Confiabilidade e consistência

| ID | Requisito | Meta / verificação |
|---|---|---|
| RNF-REL-01 | **Idempotência na publicação**: uma `Publication` gera no máximo um post na plataforma | Teste de caos: matar o worker em cada passo do publish e reiniciar → 0 duplicatas |
| RNF-REL-02 | Retry com backoff exponencial + jitter apenas para erros transitórios (rede, 5xx, 429) | Política por adaptador; máx. tentativas configurável (padrão 5) |
| RNF-REL-03 | Erros permanentes (validação, permissão, política) não são retentados automaticamente; viram `needs_attention` | Classificação de erro por adaptador, coberta por testes |
| RNF-REL-04 | Resultado incerto → estado `unknown` → reconciliação antes de qualquer nova tentativa | Teste de integração com mock que dá timeout após sucesso |
| RNF-REL-05 | O banco é a fonte da verdade do agendamento; perder a fila não perde agendamentos | Teste: apagar jobs pendentes → o *tick* do agendador recria |
| RNF-REL-06 | Jobs sobrevivem a reinício (fila persistente) | pg-boss em PostgreSQL |
| RNF-REL-07 | Disponibilidade do painel | 99% mensal (VPS única é aceitável no uso interno) |
| RNF-REL-08 | Pontualidade do agendamento | Publicação iniciada até 2 min após o horário em 99% dos casos |

## 2. Desempenho e capacidade

| ID | Requisito | Meta |
|---|---|---|
| RNF-PER-01 | Upload de até 2 GB por arquivo, direto ao storage (sem passar pela aplicação) | Multipart com URL pré-assinada |
| RNF-PER-02 | Processamento de um vídeo de 60 s 1080p (análise + até 4 versões) | < 5 min na VPS de referência |
| RNF-PER-03 | Geração de textos com IA para as 4 redes | < 60 s |
| RNF-PER-04 | Concorrência controlada: FFmpeg limitado a N jobs simultâneos (padrão 1) para não derrubar a VPS | Configurável por fila |
| RNF-PER-05 | Painel responsivo | Páginas principais < 2 s (p95) |

## 3. Segurança (detalhes em [13-seguranca.md](13-seguranca.md))

| ID | Requisito |
|---|---|
| RNF-SEC-01 | Tokens OAuth e chaves de API cifrados em repouso (AES-256-GCM, chave mestra fora do banco) |
| RNF-SEC-02 | Segredos nunca em logs, respostas de API, front-end ou repositório |
| RNF-SEC-03 | Escopos OAuth mínimos necessários por plataforma |
| RNF-SEC-04 | HTTPS obrigatório; cookies `Secure`, `HttpOnly`, `SameSite=Lax`; proteção CSRF nos callbacks OAuth (`state` + PKCE quando suportado) |
| RNF-SEC-05 | Validação de arquivos (tipo real via ffprobe/magic bytes, não pela extensão; limite de tamanho) |
| RNF-SEC-06 | Backup diário do PostgreSQL com retenção de 14 dias e teste de restauração mensal |
| RNF-SEC-07 | Princípio do menor privilégio por papel no painel; trilha de auditoria |

## 4. Observabilidade (detalhes em [12-monitoramento.md](12-monitoramento.md))

| ID | Requisito |
|---|---|
| RNF-OBS-01 | Logs estruturados JSON com `requestId`/`jobId`/`contentId`/`publicationId`/`platform` |
| RNF-OBS-02 | Captura de exceções com contexto (Sentry ou equivalente) |
| RNF-OBS-03 | Painel de saúde: filas, falhas, cotas, tokens a expirar, custo do mês |
| RNF-OBS-04 | Alertas (e-mail/Telegram/Discord) para: publicação falhou, token expira em < 7 dias, cota > 80%, orçamento de IA > 80%, disco > 80% |

## 5. Custos

| ID | Requisito |
|---|---|
| RNF-COST-01 | Registro do custo de cada chamada de IA/transcrição/busca (tokens, unidades, US$) em `CostLedger` |
| RNF-COST-02 | Orçamento mensal de IA por marca com alerta em 80% e bloqueio de chamadas não essenciais em 100% |
| RNF-COST-03 | Não reprocessar com IA o que não mudou (cache por hash de entrada) |
| RNF-COST-04 | Política de retenção de renditions (ex.: apagar versões derivadas 30 dias após publicadas; original preservado) |

## 6. Manutenibilidade e evolução

| ID | Requisito |
|---|---|
| RNF-MNT-01 | Arquitetura modular: domínio, mídia, IA e publicação em módulos separados com dependências unidirecionais (ver [03](03-arquitetura.md)) |
| RNF-MNT-02 | Nova plataforma = novo adaptador implementando a interface `PlatformAdapter`, sem alterar o núcleo |
| RNF-MNT-03 | Novo formato (ex.: carrossel) = novo `PublicationFormat` + perfis de mídia, sem mudar o fluxo de aprovação |
| RNF-MNT-04 | TypeScript estrito; lint e formatação automáticos; migrações de banco versionadas |
| RNF-MNT-05 | Prompts de IA versionados em arquivos, com conjunto de exemplos de avaliação |
| RNF-MNT-06 | Documentação de decisões (ADRs) atualizada a cada mudança arquitetural |

## 7. Testabilidade (detalhes em [14-testes.md](14-testes.md))

| ID | Requisito |
|---|---|
| RNF-TST-01 | Cobertura de testes unitários ≥ 80% nos módulos de domínio, validação e adaptadores |
| RNF-TST-02 | Adaptadores testados contra *fixtures* gravadas de respostas reais das APIs |
| RNF-TST-03 | Pipeline de vídeo testado com vídeos de amostra (vertical, horizontal, VFR, HEVC, sem áudio, corrompido) |
| RNF-TST-04 | CI executa lint, typecheck e testes a cada push |

## 8. Conformidade e políticas (detalhes em [18-originalidade-e-politicas.md](18-originalidade-e-politicas.md))

| ID | Requisito |
|---|---|
| RNF-POL-01 | Somente APIs oficiais; respeitar limites de taxa e termos de cada plataforma |
| RNF-POL-02 | Aprovação humana obrigatória antes de toda publicação |
| RNF-POL-03 | Rotulagem de conteúdo gerado/alterado por IA quando aplicável (campos oficiais de cada API) |
| RNF-POL-04 | LGPD: dados pessoais mínimos (usuários internos); métricas são agregadas da própria conta |

## 9. Localização

| ID | Requisito |
|---|---|
| RNF-L10N-01 | Interface em pt-BR; datas no timezone da marca; armazenamento sempre em UTC |
| RNF-L10N-02 | Textos gerados em pt-BR por padrão, idioma configurável por marca |
