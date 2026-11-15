# 15 — Custos estimados de infraestrutura e APIs

> Valores pesquisados em 15/11/2026, sem impostos. Fontes e tabelas completas: [`_pesquisa/custos-infra-fontes.md`](_pesquisa/custos-infra-fontes.md). Preços de LLM: tabela de preços da Anthropic (confirmar antes de fechar orçamento). Câmbio não fixado: valores mantidos na moeda original.

## 1. Premissas de volume

| Item | Valor |
|---|---|
| Vídeos novos | 1–3 por dia (≈ 30–90/mês) |
| Duração | 30 s a 3 min (média 60 s) |
| Original | 50–300 MB |
| Plataformas por vídeo | até 4 |
| Notícias que exigem fact-check | ~40% dos vídeos |
| Usuários do painel | até 5 |

## 2. Infraestrutura mensal

| Item | Escolha | Custo/mês |
|---|---|---|
| VPS | Hetzner CPX32 (4 vCPU, 8 GB, 160 GB) em Helsinque | €30,49 (≈ US$ 35) |
| VPS (alternativa barata) | Hetzner CX33 quando houver estoque | €8,99 |
| VPS (alternativa Brasil) | Hostinger KVM 4 | R$ 59,99 promo / R$ 149,99 renovação |
| PostgreSQL | Self-hosted na VPS | US$ 0 |
| Storage | Cloudflare R2 (≤ 50 GB com retenção de renditions) | US$ 0–1 (10 GB grátis, US$ 0,015/GB, sem egress) |
| Backups | `pg_dump` cifrado no R2 | incluso acima |
| Domínio | `.com.br` ou `.com` | ≈ US$ 1 |
| Observabilidade | Sentry free, uptime free | US$ 0 |
| **Subtotal infra** | | **≈ US$ 12–37** |

## 3. IA e serviços por uso

Estimativa por vídeo (Claude Opus 5.5 a US$ 4 / US$ 20 por milhão de tokens; *effort* baixo/médio; inclui tokens de raciocínio estimados):

| Tarefa | Entrada (tokens) | Saída (tokens) | Custo estimado |
|---|---|---|---|
| `analyze` (texto + 5 quadros) | ~7.000 | ~2.500 | ~US$ 0,08 |
| `fact_check` (40% dos vídeos; ~5 buscas a US$ 10/1.000 + resultados como entrada) | ~20.000 | ~2.000 | ~US$ 0,17 × 0,4 = US$ 0,07 |
| `generate_copy` (4 redes, parte estável em cache) | ~5.000 | ~4.000 | ~US$ 0,10 |
| `regenerate_copy` (média 1 por vídeo) | ~3.000 | ~1.500 | ~US$ 0,04 |
| `watermark_scan` (Haiku 5.5) | ~5.000 | ~200 | < US$ 0,001 |
| Transcrição (Groq whisper-large-v3-turbo, US$ 0,04/h) | 1 min | — | ~US$ 0,001 |
| **Total por vídeo** | | | **≈ US$ 0,30** |

| Volume | IA + transcrição/mês |
|---|---|
| 30 vídeos | ≈ US$ 9 |
| 90 vídeos | ≈ US$ 27 |
| `weekly-insights` (Batch API, 50% off) | ≈ US$ 0,50 |

Alavancas se quiser reduzir: `claude-sonnet-5-5` (US$ 2 / US$ 10) para `generate_copy`/`regenerate_copy` corta ~50% dessas tarefas; Tavily (camada gratuita) no lugar do web search da Claude; *effort* `low` em `analyze`. Tudo é configuração (sem mudança de código), medida contra o conjunto golden de avaliação.

## 4. APIs das redes sociais

| API | Custo direto | Custos indiretos |
|---|---|---|
| Meta Graph API (IG + FB) | Nenhum preço documentado (uso gratuito) | Business Manager/portfólio; tempo de setup; Business Verification só se precisar de Advanced Access |
| YouTube Data/Analytics API | Nenhum preço documentado (cota gratuita) | Auditoria de compliance apenas para aumentar cota |
| TikTok | Não usado (manual assistido) | Tempo da pessoa que posta (~2 min por vídeo) |

## 5. Total mensal estimado

| Cenário | Infra | IA | **Total** |
|---|---|---|---|
| Enxuto (CX33, 30 vídeos) | ≈ US$ 12 | ≈ US$ 9 | **≈ US$ 21** |
| Referência (CPX32, 90 vídeos) | ≈ US$ 37 | ≈ US$ 28 | **≈ US$ 65** |
| Folgado (CPX32, 90 vídeos, Opus em tudo + 2 regenerações/vídeo) | ≈ US$ 37 | ≈ US$ 40 | **≈ US$ 77** |

O orçamento de IA por marca (`aiMonthlyBudgetUsd`, sugerido US$ 50) com alertas impede surpresas.

## 6. Custos de crescimento (referência)

| Mudança | Impacto |
|---|---|
| 5 marcas × 3 vídeos/dia | IA ≈ US$ 135/mês; VPS maior ou worker de mídia dedicado (+€30); YouTube: 100 uploads/dia **compartilhados** pelo projeto |
| Redis gerenciado (se adotado) | +US$ 10–30/mês |
| Postgres gerenciado com réplica | +US$ 15–50/mês |

## 7. Custo de desenvolvimento (estimativa grosseira, 1 dev full-stack sênior)

| Fases | Semanas |
|---|---|
| 1 Fundação | 1,5–2 |
| 2 Upload e biblioteca | 1–1,5 |
| 3 Processamento audiovisual | 2 |
| 4 Metadados com IA | 2 |
| 5 Instagram + Facebook | 2–3 |
| 6 YouTube | 1–1,5 |
| 7 TikTok (manual assistido) | 0,5–1 |
| 8 Agendamento + publicação multiplataforma + piloto automático (grade e fila) | 2,5–3 |
| 9 Métricas e analytics | 2 |
| 10 Evoluções | contínuo |
| **Total até a Fase 9** | **≈ 14,5–18 semanas** |

Prazos de aprovação das plataformas não estão incluídos e não são controláveis — por isso o credenciamento começa em paralelo na Fase 1 ([17](17-roadmap-e-criterios-de-aceite.md)).
