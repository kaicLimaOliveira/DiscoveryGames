# 20 — Monetização

> Objetivo de negócio por trás das integrações: **monetizar a página nas quatro redes**. Este documento resume os programas atuais, os requisitos e o que a central faz para não comprometer a elegibilidade.
> Pesquisa feita em 15/11/2026. Fontes completas, com status (✅ oficial · ⚠️ secundária · ❓ não confirmado): [`_pesquisa/monetizacao-fontes.md`](_pesquisa/monetizacao-fontes.md). **Programas de monetização mudam com frequência; confirme sempre no painel de cada plataforma** (YouTube Studio → Ganhar dinheiro; Painel Profissional do Facebook/Instagram → Monetização; TikTok Studio).

## 1. Resumo por plataforma

| Plataforma | Programa principal | Requisitos de entrada (resumo) | Brasil | Status |
|---|---|---|---|---|
| YouTube | Programa de Parcerias (YPP) | **Hoje:** 1.000 inscritos + 4.000 h de exibição pública em 12 meses **ou** 10 mi de views de Shorts em 90 dias. Nível inicial (apoio dos fãs, Shopping): 500 inscritos. **A partir de 01/02/2027:** 8.000 h ou 20 mi de views de Shorts para receita de anúncios (quem já estiver no programa mantém as regras) | Sim | ✅ |
| Facebook | Monetização de Conteúdo do Facebook (unificou in-stream, Reels e bônus) | **Só por convite** em nov/2026; dá para "demonstrar interesse" no Painel Profissional. Creator Fast Track (pagamento garantido por 3 meses para quem já tem público em outras redes) | Programa: ❓ · Fast Track no Brasil: ⚠️ (imprensa, nov/2026) | ✅ / ❓ |
| Instagram | Bônus (por convite), assinaturas, presentes, conteúdo de marca | Bônus só por convite; assinaturas e presentes variam por país | Assinaturas: ⚠️ provável · Presentes: ❓ | ✅ / ⚠️ |
| TikTok | Creator Rewards Program | 18+, **10 mil seguidores**, **100 mil views em 30 dias**, **conta pessoal** (conta Business **não** é elegível), vídeos **com mais de 1 minuto** e originais | ⚠️ (só fontes secundárias) | ✅ (requisitos) |

Em todas as redes, **parcerias com marcas** (conteúdo patrocinado) são uma fonte de receita independente dos programas, sempre com as ferramentas oficiais de divulgação (ver §5).

## 2. Implicações para o projeto

### 2.1 Duração dos vídeos: o ponto ideal fica entre 61 e 90 s

| Regra | Fonte |
|---|---|
| TikTok Creator Rewards só remunera vídeos com **mais de 1 min** | ✅ Newsroom TikTok |
| Facebook Reels via API aceita **3–90 s** | ✅ [facebook.md](07-integracoes/facebook.md) |
| YouTube Shorts aceita até **3 min**, mas Shorts com **mais de 1 min e reivindicação de Content ID** ficam bloqueados e sem monetização | ⚠️ |

**Recomendação editorial:** vídeos de **61 a 90 s, com música livre de reivindicação** (ex.: Biblioteca de Áudio do YouTube ou trilha própria) são elegíveis e monetizáveis nas quatro redes ao mesmo tempo. A central exibe isso como dica no upload, não como bloqueio:

- `MONETIZATION_DURATION_HINT` (info): duração ≤ 60 s → "não elegível ao Creator Rewards do TikTok"; > 90 s → "não vai para o Facebook".
- `SHORTS_MUSIC_CLAIM_RISK` (warning): Short > 60 s com música declarada como "licenciada" (que não seja trilha própria ou biblioteca royalty-free) ou "desconhecida".

### 2.2 TikTok: conta pessoal × Business

- O Creator Rewards **exige conta pessoal**. Contas Business/organização perdem Creator Rewards, assinaturas e TikTok One (✅).
- Isso **reforça o ADR 0004 (manual assistido)**: a integração automática via TikTok API for Business exigiria conta Business, que **impediria** o Creator Rewards. **Atualização do gatilho de reavaliação:** só migrar para a API for Business se a monetização do TikTok vier de parcerias/marcas e não do Creator Rewards.
- **Ação:** manter a conta TikTok como **pessoal** (se for Business, voltar para pessoal; prazos de troca ❓).

### 2.3 Originalidade é o requisito número 1 em todas as redes

- YouTube: "conteúdo reutilizado" é o motivo mais comum de reprovação. **Vídeos que apenas leem notícias de terceiros contam como reutilizados** (✅). Notícias precisam de **análise, opinião ou contexto próprio**.
- Facebook: Páginas que postam principalmente conteúdo não original podem ser desmonetizadas (✅).
- TikTok: não contam conteúdo com marca d'água de outros, cópias levemente alteradas, clipes em loop, posts só de texto + música (✅/⚠️).
- **Publicar o próprio vídeo original em várias redes não é proibido** por nenhuma das páginas oficiais lidas. O risco é a **marca d'água de outro app** → sempre publicar o arquivo limpo exportado do editor (a central já usa o original/rendition, nunca um arquivo baixado de outra rede).
- O YouTube pode tirar a monetização de um canal inteiro quando não consegue confirmar a autoria → a central **guarda o original intacto com hash** (já previsto em RF-ING-03), o que serve como prova.

Novas regras de compliance (complementam [18 §2.2](18-originalidade-e-politicas.md)):

| Código | Detecção | Severidade |
|---|---|---|
| `NEWS_NEEDS_COMMENTARY` | Categoria "notícia" e a análise de IA indica que o vídeo só reproduz o texto da fonte, sem opinião ou contexto próprio | warning |
| `GAMEPLAY_COMMERCIAL_RIGHTS` | Jogo sem registro de política do publisher que permita uso comercial/monetização | warning |
| `MONETIZATION_DURATION_HINT` | Ver §2.1 | info |
| `SHORTS_MUSIC_CLAIM_RISK` | Ver §2.1 | warning |

### 2.4 Gameplay

Monetizar gameplay exige que a distribuidora do jogo permita uso comercial (✅ YouTube). A maioria das grandes publishers tem política pública de vídeos; cadastre o link e o resumo no catálogo de jogos ([18 §3](18-originalidade-e-politicas.md)), e a regra `GAMEPLAY_COMMERCIAL_RIGHTS` alerta quando faltar.

## 3. Pagamentos e impostos (YouTube como referência)

| Item | Detalhe | Status |
|---|---|---|
| Recebimento | Conta **AdSense** vinculada ao canal; recebedor pessoa física (CPF) ou empresa (CNPJ), independente do e-mail dono do canal | ✅ |
| Impostos dos EUA | **Com** formulário fiscal enviado: retenção de 30% apenas sobre a receita de espectadores dos EUA (pode ser menor se houver tratado). **Sem** formulário (pessoa física): 24% sobre **todos** os ganhos | ✅ (taxas) / ❓ (tratado com o Brasil) |
| Imposto no Brasil | Receita do exterior é tributável (pessoa física ou empresa) | Consultar contador |

**Ação:** enviar o formulário fiscal no AdSense assim que a conta for criada e definir com um contador se o recebimento será como pessoa física ou empresa (a escolha também afeta, no futuro, a possibilidade de integrar o TikTok via API for Business, que exige empresa).

## 4. O que a central pode medir para acompanhar a elegibilidade

Fase 9 (métricas) com um painel "Caminho para monetização":

| Plataforma | Indicador | Fonte |
|---|---|---|
| YouTube | Inscritos, horas de exibição públicas (12 meses), views de Shorts (90 dias) vs metas do YPP vigentes | YouTube Analytics API (`subscribersGained`, `estimatedMinutesWatched`, views com `creatorContentType=SHORTS`) |
| TikTok | Seguidores, views em 30 dias, % de vídeos > 1 min | Registro manual (sem API — ADR 0004) |
| Facebook / Instagram | Seguidores, views/alcance | Graph API (insights de conta e mídia) |

As metas ficam em `Setting` (editáveis), porque os programas mudam. A UI deixa claro que o painel oficial de cada plataforma é a fonte da verdade.

## 5. Publicidade e conteúdo patrocinado

- Usar **sempre** as ferramentas oficiais de divulgação de cada plataforma (toggles de conteúdo de marca/parceria paga) — a central já bloqueia publicação sem o toggle quando o conteúdo é declarado patrocinado (`BRANDED_CONTENT_REQUIRED`).
- No Brasil, o **guia de publicidade por influenciadores do CONAR** (atualizado em mai/2026) é a referência. Segundo a imprensa, ele prioriza as ferramentas de marcação das próprias plataformas (⚠️). Ler o guia oficial antes do primeiro conteúdo patrocinado.

## 6. Checklist de monetização (fora do código)

- [ ] YouTube: canal de marca verificado (ADR 0006); acompanhar a aba "Ganhar dinheiro"; buscar entrada no YPP **antes de 01/02/2027** se possível (as metas dobram depois).
- [ ] TikTok: conta **pessoal**; vídeos > 1 min para Creator Rewards; confirmar disponibilidade no Brasil no TikTok Studio.
- [ ] Facebook: "demonstrar interesse" na Monetização de Conteúdo no Painel Profissional; acompanhar o Creator Fast Track no Brasil.
- [ ] Instagram: verificar no Painel Profissional quais recursos (assinaturas, presentes, bônus) aparecem para a conta.
- [ ] Catálogo de jogos: registrar a política de vídeos/monetização de cada publisher usado.
- [ ] Contador: pessoa física × empresa; formulário fiscal dos EUA no AdSense.
- [ ] Música: padronizar trilhas próprias ou bibliotecas royalty-free.
