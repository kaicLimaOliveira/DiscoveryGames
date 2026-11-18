# 00 — Visão geral do produto

> Documento de planejamento. Nenhum código de implementação foi escrito nesta etapa.
> Data de referência: 2026-11-15. Atualizado em 2026-11-18 com o escopo v2 (organizações e cortador, [spec](superpowers/specs/2026-11-17-organizacoes-e-cortador-design.md)).

## 1. O que é

Uma **Central Inteligente de Automação de Conteúdo** de uso interno. A equipe envia **um vídeo original** (vertical, gamer: gameplay, curiosidade, notícia, entretenimento) e a central:

1. preserva o original intacto;
2. analisa o arquivo (técnica) e o conteúdo (IA);
3. gera versões tecnicamente compatíveis com cada rede;
4. gera textos específicos por rede (legenda, título, descrição, hashtags);
5. aplica validações de qualidade, políticas e originalidade;
6. coloca tudo numa **fila de aprovação humana**;
7. publica ou agenda, **de forma independente por plataforma**, via APIs oficiais;
8. coleta métricas e mostra o que funciona melhor em cada rede.

Princípio central: **produzir uma vez, distribuir com adaptação inteligente — e sempre com aprovação humana.**

## 2. Para quem

| Perfil | Uso |
|---|---|
| Dono/gestor da página | Aprova, agenda, acompanha resultados, configura contas |
| Editor/produtor | Sobe vídeos, preenche contexto, revisa textos |
| Outras páginas/canais do mesmo dono | Cada página = uma **Organização** (antes "Marca") com suas próprias contas conectadas e seus próprios membros |

**Escopo de negócio decidido:** uso **interno**. Não é SaaS, não há clientes externos e não há cobrança. A partir do escopo v2 o painel é **multi-organização**: o dono administra várias páginas de nicho (por exemplo games e academia) no mesmo painel, cada uma uma **Organização** (`Organization`) com contas vinculadas, membros e papéis próprios, e uma organização não vê nada de outra ([ADR 0009](adr/0009-organizacoes-e-contas.md)).

## 3. Plataformas no escopo

| Plataforma | Formato inicial | Formatos futuros |
|---|---|---|
| Instagram | Reels | Carrossel, post de imagem |
| Facebook (Página) | Reels | Vídeo, post |
| TikTok | Vídeo — **manual assistido** (central prepara vídeo e texto; pessoa posta no app) | Integração automática via TikTok API for Business, se a empresa cumprir os requisitos de registro |
| YouTube | Shorts | Vídeo longo |

Detalhes, limitações e requisitos de aprovação de cada API: [`07-integracoes/`](07-integracoes/).

## 4. Objetivos

- **Objetivo de negócio (decidido em 2026-11-15): monetizar a página nas quatro redes.** Toda decisão de produto deve preservar a elegibilidade aos programas de monetização (originalidade, conta pessoal no TikTok, duração 61–90 s, música sem reivindicação). Ver [20 — Monetização](20-monetizacao.md).
- **Multi-organização:** várias organizações, cada uma com suas contas de Instagram, Facebook, YouTube e @ do TikTok, filtradas pela organização ativa e verificadas no servidor ([ADR 0009](adr/0009-organizacoes-e-contas.md)).
- **Cortador de vídeos** (escopo v2): receber um vídeo longo (MP4 ou link do YouTube), a IA sugere os melhores trechos e a central gera cortes verticais para revisão, aprovação e publicação ([ADR 0008](adr/0008-cortador-hibrido.md)).
- **Trava de direitos:** toda fonte de vídeo tem uma declaração de direitos obrigatória; fonte sem direitos (`none`) nunca vai para publicação nem para download ([ADR 0010](adr/0010-trava-de-direitos.md)).
- Reduzir o trabalho manual de publicar o mesmo vídeo em 4 redes a **um envio + uma revisão**.
- **Piloto automático:** o dono define uma grade (de quanto em quanto tempo postar em cada rede) e a central pega o próximo conteúdo aprovado da fila e publica sozinha ([11 §7](11-agendamento.md), ADR 0007). A aprovação humana continua obrigatória, mas é feita com um clique e pode ser em lote.
- Textos nativos de cada rede, sem inventar fatos sobre jogos.
- Publicação confiável: **nunca duplicar** um post, tentar novamente só o que falhou.
- Histórico comparável de desempenho por plataforma, jogo e categoria.
- Arquitetura que aceita nova plataforma ou novo formato **sem mexer no núcleo**.

## 5. Não-objetivos (fora do escopo, deliberadamente)

- Edição de vídeo manual ou criativa dentro da central (efeitos, timeline), além de escolher e ajustar o início e o fim de um corte. A central corta, reenquadra e adapta tecnicamente.
- Modo orgânico (agente de notícias e posts de feed): débito técnico D1 em [21](21-debitos-tecnicos.md).
- Republicação de conteúdo de terceiros, "reposts" em massa, contas múltiplas para a mesma audiência.
- Automação de navegador (Selenium/Puppeteer) para publicar quando existe API oficial.
- Respostas automáticas a comentários/DMs (pode entrar num roadmap futuro, fora deste plano).
- Multi-inquilino SaaS com clientes externos e cobrança (fora; ver [riscos](16-riscos-e-limitacoes.md) para o que mudaria). As organizações são do mesmo dono.

## 6. Anti-objetivos (o que tornaria o projeto um fracasso mesmo "funcionando")

- Publicar algo **sem aprovação humana**.
- **Publicar cortes de fontes sem direitos registrados** (trava de direitos obrigatória).
- Uma organização ver ou publicar nas contas de outra.
- Publicar em duplicidade na mesma conta.
- A IA afirmar fatos falsos (datas de lançamento, notas, rumores como verdade).
- Contas penalizadas por conteúdo reutilizado, marca d'água de outra rede ou música não licenciada.
- Custo de IA ou infraestrutura fora de controle.
- Sistema tão complexo que uma pessoa não consiga operá-lo e mantê-lo.

## 7. Decisões principais (resumo)

| Tema | Decisão | Onde |
|---|---|---|
| Arquitetura | Monolito modular TypeScript: app Nuxt 4 (painel + API) + processo *worker* | [03](03-arquitetura.md) |
| Fila/agendamento | PostgreSQL + pg-boss (sem Redis no início) | [04](04-tecnologias.md), [11](11-agendamento.md) |
| Arquivos | Storage S3-compatível (Cloudflare R2 em produção; MinIO no dev) | [04](04-tecnologias.md) |
| Vídeo | FFmpeg/ffprobe; *remux* quando possível, *transcode* só quando necessário | [10](10-pipeline-audiovisual.md) |
| IA | Chamadas pontuais ao LLM com saída estruturada; **sem agentes autônomos** | [09](09-estrategia-ia.md) |
| Orquestração | Código próprio (state machines + filas); **n8n não é usado** no núcleo | [04](04-tecnologias.md) |
| Publicação | Adaptadores por plataforma atrás de uma interface comum; idempotência por publicação. IG + FB com um único System User do Business Manager; YouTube via OAuth; **TikTok em modo manual assistido** | [07](07-integracoes/00-estrategia-e-abstracao.md) |
| Facebook > 90 s | Reels via API só aceitam 3–90 s → vídeos mais longos **não** vão para o Facebook (bloqueio com aviso) | [07](07-integracoes/00-estrategia-e-abstracao.md) |
| Automação da postagem | Grade recorrente por rede + fila de conteúdos aprovados + alocador automático; nunca repost quando a fila esvazia | [11 §7](11-agendamento.md), [ADR 0007](adr/0007-grade-recorrente-e-fila.md) |
| Organizações | `Brand` virou `Organization`; contas vinculadas por organização, uma conexão Meta por organização | [ADR 0009](adr/0009-organizacoes-e-contas.md) |
| Cortador | Híbrido: transcrição por API, Claude escolhe os trechos, FFmpeg corta e reenquadra | [ADR 0008](adr/0008-cortador-hibrido.md) |
| Direitos | Declaração obrigatória por fonte; `none` nunca publica nem baixa | [ADR 0010](adr/0010-trava-de-direitos.md) |
| Hospedagem | 1 VPS com Docker Compose | [04](04-tecnologias.md), [15](15-custos.md) |

## 8. Mapa da documentação

Veja o índice em [`README.md`](README.md).
