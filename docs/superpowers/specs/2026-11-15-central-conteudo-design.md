# Design — Central Inteligente de Automação de Conteúdo (resumo)

O design completo é o pacote em [`docs/`](../../README.md). Este arquivo registra o resultado da conversa de design.

## Intenção
Central de uso **interno** para uma página gamer: um vídeo original entra, sai adaptado para IG/FB/TikTok/YouTube com textos por rede, aprovação humana obrigatória, publicação/agendamento independente por plataforma e métricas. Arquitetura pronta para várias páginas do mesmo dono.

## Abordagens consideradas
| Abordagem | Escolha |
|---|---|
| A. Monolito modular TS (Nuxt 4 + worker) + fila no Postgres (pg-boss) + R2 + FFmpeg, 1 VPS | ✅ escolhida pelo dono do produto |
| B. A + Redis/BullMQ | evolução futura (gatilhos em 03 §8) |
| C. n8n como orquestrador | descartada no núcleo |
| D. Serverless | descartada (FFmpeg) |

## Decisões do dono do produto
- Uso interno (não SaaS).
- Abordagem A.
- Facebook: vídeos > 90 s não são publicados (Reels via API: 3–90 s).
- Meta: IG e Página no mesmo Business Manager → System User único.
- TikTok: modo manual assistido (sem registro de empresa para a API for Business).
- YouTube: canal de marca com Gmail dedicado como dono (plano B: transferir para Workspace). Monetização futura não depende do tipo de conta.

## Decisões técnicas tomadas pelo arquiteto (revisáveis)
Ver lista em [README](../../README.md) e ADRs 0001–0005.
