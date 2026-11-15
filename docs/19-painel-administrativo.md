# 19 — Painel administrativo (telas)

Requisitos em [01 §9](01-requisitos-funcionais.md). Esboços em texto para orientar layout; o design visual fica com quem implementar (Nuxt UI como base, tema claro/escuro, pt-BR).

## Navegação

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│ [Marca ▾]    │                                                          │
│ Dashboard    │                                                          │
│ Biblioteca   │                     conteúdo da tela                      │
│ Aprovação (3)│                                                          │
│ Calendário   │                                                          │
│ Piloto autom.│                                                          │
│ Saúde  ⚠     │                                                          │
│ Configurações│                                                          │
└──────────────┴──────────────────────────────────────────────────────────┘
```

## Dashboard

```
[Publicados 30d: 74] [Agendados: 12] [Falhas abertas: 1 ⚠] [Views 30d: 1,2 M] [IA no mês: US$ 18/50]
┌ Views por plataforma (30d, linhas) ──────────┐ ┌ Top conteúdos (views 72h vs mediana) ┐
│  IG ── FB ── TT ── YT                         │ │ 1. Elden Ring – boss secreto   3,1× │
└───────────────────────────────────────────────┘ │ 2. Top 5 easter eggs GTA      2,4× │
┌ Desempenho por categoria × plataforma (heatmap)┐ └────────────────────────────────────┘
```

## Biblioteca

```
[+ Novo conteúdo]  Buscar [__________]  Jogo [▾] Categoria [▾] Status [▾] Período [▾]
┌ miniatura │ Título                     │ Jogo        │ Categoria  │ Status            │ Redes      ┐
│ ▶        │ Boss secreto Elden Ring     │ Elden Ring  │ Curiosidade│ Pronto p/ revisão │ IG FB TT YT│
│ ▶        │ Anúncio DLC (notícia)       │ ...         │ Notícia    │ ⚠ fact-check      │ IG YT      │
```

Detalhe do conteúdo: player do original, dados técnicos (probe), declarações de direitos, histórico de processamento (passos, tempos, erros), renditions por plataforma (estratégia passthrough/remux/transcode), transcrição, análise de IA, alertas.

## Editor de publicações / Central de aprovação

```
┌ Conteúdo: Boss secreto Elden Ring ───────────────────────────────────────────────┐
│ Abas: [Instagram ✔] [Facebook ●] [TikTok ●] [YouTube ⚠]                           │
│ ┌ player da versão do IG ┐  Legenda (1.840/2.200)                                  │
│ │       9:16             │  [texto editável.........................]              │
│ │                        │  Hashtags (5/30): #eldenring #soulslike ...            │
│ └────────────────────────┘  Opções: [x] compartilhar no feed  Capa: [quadro 3 ▾] │
│ Alertas: ⚠ música declarada "biblioteca da plataforma"                            │
│ Fact-check: — (não aplicável)                                                     │
│ [Regenerar com instrução…] [Histórico de versões]                                  │
│ [Rejeitar] [Pedir alterações] [Aprovar] → [Publicar agora] [Agendar: 18/11 19:00] │
└───────────────────────────────────────────────────────────────────────────────────┘
```

A aba TikTok (modo manual assistido) mostra "Baixar vídeo", "Copiar texto", checklist para o app (rótulo de IA, conteúdo de marca, privacidade pública) e o campo "Colar URL do post". O mesmo bloco aparece em qualquer publicação trocada para modo manual.

## Calendário

Ver esboço em [11 §5](11-agendamento.md). Publicações alocadas pela grade aparecem com ícone de "automático"; horários da grade ainda vazios aparecem tracejados.

## Piloto automático (grade + fila)

```
┌ Grades ──────────────────────────────────────┐ ┌ Fila (aprovados) — cobre: IG 4d · FB 6d · YT 3d · TT 4d ┐
│ IG  seg–sex 12:00, 19:00 · sáb 15:00 [ativa] │ │ ⠿ 1. 🔥 Anúncio DLC (notícia, expira 17/11 10:00)        │
│ FB  todo dia 19:30                   [ativa] │ │ ⠿ 2. Boss secreto Elden Ring        IG✔ FB✔ YT✔ TT✔      │
│ YT  a cada 8 h, 09:00–23:00          [ativa] │ │ ⠿ 3. Top 5 easter eggs GTA (2 min)  IG✔ FB— YT✔ TT✔      │
│ TT  todo dia 20:00 (manual)          [⏸]    │ │ ⠿ 4. ...                                                 │
│ [+ Nova grade]                               │ │ [Aprovar pendentes em lote (5)]                          │
└──────────────────────────────────────────────┘ └──────────────────────────────────────────────────────────┘
Próximos 7 dias: lista por rede com horário → conteúdo alocado (🔒 congelado < 60 min)
```

Arrastar reordena a fila (realoca horários não congelados). Item: fixar em horário, marcar urgente, definir validade, remover da fila.

## Saúde

Filas (pendentes/ativos/falhos), publicações `needs_attention`/`unknown` com botão "ver tentativas", contas e validade de tokens, cotas por plataforma, custos do mês, último backup, botão **Pausar todas as publicações**.

## Configurações

- **Contas:** conectar/desconectar por plataforma, status, escopos concedidos, capacidades, último health check.
- **Marca:** nome, timezone, idioma, guia de voz, hashtags fixas, horários padrão por plataforma, espaçamento mínimo.
- **IA:** modelo e *effort* por tarefa, orçamento mensal, domínios confiáveis para fact-check.
- **Usuários:** convidar, papéis, 2FA obrigatório.
- **Alertas:** e-mail, Telegram/Discord.
- **Credenciais dos apps:** apenas status (configuradas via ambiente; nunca exibidas).
