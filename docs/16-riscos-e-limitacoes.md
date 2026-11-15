# 16 — Riscos técnicos e limitações

Escala: Probabilidade (B/M/A) × Impacto (B/M/A).

## 1. Riscos de plataforma

| # | Risco | P | I | Mitigação |
|---|---|---|---|---|
| R1 | **TikTok sem integração por API** (Content Posting API rejeita uso interno; API for Business exige registro como empresa, não atendido hoje) | — (materializado) | M | **Decisão: manual assistido** (ADR 0004): passo manual de ~2 min por vídeo, sem métricas automáticas. Reavaliar a API for Business se a empresa atender os requisitos (CNPJ, e-mail corporativo, site) |
| R2 | Conteúdo publicado por app Meta em **modo desenvolvimento** pode não ficar público | M | A | PoC na Fase 5 antes de construir o adaptador completo; se necessário, colocar o app em modo Live com Standard Access |
| R3 | Mudanças frequentes de API e métricas (Meta depreciou `plays`/`impressions`; YouTube mudou cotas e regra de privado em 2026) | A | M | Adaptadores isolados; fixtures de contrato; revisão trimestral; assinatura de changelogs; versão da Graph API fixada e atualizada deliberadamente |
| R4 | Cota do YouTube é **por projeto** (100 uploads/dia) e as políticas exigem um único projeto → limita o crescimento multi-canal | B (hoje) / M (futuro) | M | `QuotaUsage` por projeto; pedido de aumento via auditoria quando necessário |
| R5 | Limites diários: IG (50 ou 100/24 h — doc contraditória), FB Reels (30/Página/24 h), TikTok (limites de criador) | B | M | Consultar endpoints de limite quando existem; alertas no agendador |
| R6 | Restrições de formato divergentes: FB Reels via API 3–90 s; Shorts ≤ 3 min; IG Reels até 15 min | A | B | Validação por plataforma na criação da publicação; bloqueio `FORMAT_NOT_ELIGIBLE` |
| R7 | Refresh token do Google expira em 7 dias com app em *Testing*; verificação OAuth para escopos sensíveis pode ser exigida | M | M | App *In production*; testar refresh após 8 dias na Fase 6; avaliar app *Internal* via Google Workspace |
| R8 | Políticas de dados do YouTube: dados autorizados armazenados devem ser atualizados ou apagados a cada 30 dias — pode conflitar com histórico de snapshots | M | M | Validar interpretação na Fase 9; opções: manter apenas agregados derivados, ou atualizar/expurgar snapshots > 30 dias de dados do YouTube |
| R9 | Renovações de token concorrentes podem invalidar credenciais em plataformas com refresh token rotativo | B | M | Trava por conta na renovação em todas as plataformas; renovação somente no job dedicado |
| R10 | Meta lança recursos novos só na variante Unified Login do Instagram (a central usa Facebook Login + System User) | M | B | Adaptador isola a variante; reavaliar migração quando um recurso necessário for exclusivo dela |
| R11 | Sem idempotência nativa em nenhuma das APIs | A | A | State machine + `progress` persistido + reconciliação ([06 §3–5](06-fluxos.md)); testes de falha |

## 2. Riscos de conteúdo e políticas

| # | Risco | P | I | Mitigação |
|---|---|---|---|---|
| R12 | Penalização por conteúdo não original / reutilizado | M | A | Declarações obrigatórias, alertas, sem republicação de terceiros ([18](18-originalidade-e-politicas.md)) |
| R13 | Música → Content ID/bloqueios (inclusive Shorts > 1 min com claim podem ser bloqueados — ver [youtube.md](07-integracoes/youtube.md)) | M | A | Declaração de música; bloqueio para "desconhecida" no YouTube; orientação editorial |
| R14 | IA afirma fato falso | M | A | Pipeline anti-alucinação + fact-check + aprovação humana ([09 §5](09-estrategia-ia.md)) |
| R15 | Classificadores de segurança do LLM recusam temas de jogos violentos | B | B | Tratar `refusal`; fallback; edição manual |
| R16 | Detecção de marca d'água com falsos positivos/negativos | M | B | Somente aviso por padrão; responsabilidade editorial |

## 3. Riscos técnicos e operacionais

| # | Risco | P | I | Mitigação |
|---|---|---|---|---|
| R17 | VPS única = ponto único de falha | M | M | Backups diários testados; runbook de restauração < 2 h; agendamentos perdidos não são publicados às cegas (`MISSED_WINDOW`) |
| R18 | FFmpeg saturando CPU e atrasando publicações | M | M | Concorrência 1 na fila `media`; publish e media em filas separadas; worker de mídia separável |
| R19 | Disco cheio por scratch/renditions | M | M | Limpeza em `finally`; checagem de espaço; alertas; retenção |
| R20 | Vazamento de tokens | B | A | Cifragem, redação de logs, menor privilégio ([13](13-seguranca.md)) |
| R21 | Custos de IA descontrolados | B | M | Orçamento, ledger, cache por hash |
| R22 | Dependência de uma pessoa (credenciais de Business Manager/Google/TikTok) | M | A | Gerenciador de senhas compartilhado; ao menos 2 admins em cada console |
| R23 | Prazos de aprovação imprevisíveis atrasam o roadmap | A | M | Credenciamento paralelo desde a Fase 1; adaptador `fake` para não bloquear o desenvolvimento |

## 4. Limitações conhecidas (aceitas)

- Métricas não são uniformes entre plataformas; o sistema não "inventa" equivalentes.
- TikTok em modo manual: sem métricas automáticas (registro manual opcional).
- Analytics do YouTube tem 48–72 h de atraso; métricas do Instagram até 48 h.
- Agendamento depende da VPS estar no ar no horário (agendamento nativo do YouTube/Facebook é uma opção futura para reduzir essa dependência).
- A central não edita vídeo criativamente nem garante originalidade — ela alerta; a responsabilidade é editorial.
- Algumas informações das análises estão marcadas ❓ e precisam de PoC (consolidadas abaixo).

## 5. Hipóteses a validar (consolidado)

| # | Hipótese | Onde validar | Fase |
|---|---|---|---|
| H1 | Post via app Meta em modo desenvolvimento é público (ou: app Live com Standard Access funciona sem App Review) | PoC IG/FB | 5 (PoC já na trilha paralela da Fase 1) |
| H2 | Um único app Meta Business + System User publica Reels no IG vinculado e na Página | PoC | 5 |
| H3 | Upload resumable (`rupload`) funciona para Reels do IG com token de System User | PoC | 5 |
| H5 | Gerar token de System User não exige acesso extra à Marketing API para app só de Páginas | PoC | 5 |
| H6 | Com canal de marca de Gmail dedicado, app *External / In production* sem verificação mantém refresh token além de 7 dias (plano B: transferir o canal para Workspace) | Teste de 8 dias | 1→6 |
| H8 | Interpretação da regra de 30 dias de dados do YouTube para snapshots históricos | Leitura da política / consulta | 9 |
| H9 | Qualidade da transcrição Groq em pt-BR com termos de games | 10 vídeos reais | 4 |
| H10 | Limite real de publicação diária do Instagram (`content_publishing_limit`) | Chamada em produção | 5 |
| H11 | Remoção das métricas de impressões/views de 3 s do Facebook (prevista para jun/2026) já efetivada | Chamada em produção | 9 |
