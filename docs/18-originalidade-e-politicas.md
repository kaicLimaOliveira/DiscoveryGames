# 18 — Originalidade, direitos autorais e políticas das plataformas

> A central **não é** uma ferramenta de spam nem de republicação indiscriminada. Este documento lista as regras que o sistema aplica e os alertas que gera. Ele não substitui a leitura dos termos de cada plataforma nem aconselhamento jurídico.

## 1. Riscos de política relevantes para uma página gamer

| Risco | Onde aparece | Fonte (ver análises) |
|---|---|---|
| Conteúdo **não original / reutilizado** (clipes de terceiros sem transformação) perde distribuição e monetização | Facebook/Instagram (regras de conteúdo não original), YouTube (YPP "reused content"), TikTok | [facebook.md](07-integracoes/facebook.md), [youtube.md](07-integracoes/youtube.md), [instagram.md](07-integracoes/instagram.md), [tiktok.md](07-integracoes/tiktok.md) |
| **Marca d'água de outra plataforma** reduz alcance | Instagram/Facebook (recomendações), TikTok | análises por plataforma |
| **Música** não licenciada → bloqueio, mudo, desmonetização (Content ID no YouTube; bibliotecas de áudio não disponíveis via API em várias redes) | Todas | análises por plataforma |
| **Uso de gameplay**: cada publisher tem política própria de vídeos/monetização | Todas | política do publisher (registrar por jogo) |
| **Conteúdo gerado/alterado por IA realista** exige rotulagem | YouTube `containsSyntheticMedia`; Meta `is_ai_generated`; TikTok rótulo de AIGC | análises por plataforma |
| **Conteúdo de marca/publicidade** (parcerias, keys recebidas) exige divulgação | Todas (toggles de branded content) | análises por plataforma |
| **Spam / metadados enganosos** (hashtags irrelevantes, títulos clickbait falsos, excesso de hashtags) | Todas; YouTube ignora todas as hashtags acima de um limite | [youtube.md](07-integracoes/youtube.md) |
| **Volume/limites** de publicação via API | Todas | §3.3 do [07.0](07-integracoes/00-estrategia-e-abstracao.md) |
| **Spoilers / conteúdo sensível** (violência explícita de jogos M/18+) | Todas (restrição de idade/alcance) | — |

## 2. Controles do sistema

### 2.1 Declarações no upload (obrigatórias)

| Pergunta | Opções | Efeito |
|---|---|---|
| O conteúdo é original da equipe? | sim / parcialmente (inclui trechos de terceiros) / não | "não" → bloqueante; "parcialmente" → aviso + campo "qual a transformação/comentário" |
| Origem do gameplay | gravado pela equipe / material oficial de imprensa (press kit) / terceiros com autorização / outro | "outro" → aviso |
| Música | sem música / original / licenciada (informar licença) / biblioteca da plataforma / desconhecida | "desconhecida" → bloqueante para YouTube (risco Content ID) e aviso para as demais |
| Contém IA generativa realista (voz clonada, rosto, cena realista)? | sim / não | "sim" → ativa rótulos de IA obrigatórios nos campos oficiais de cada plataforma |
| Conteúdo patrocinado/parceria? | sim / não | "sim" → ativa toggles de conteúdo de marca onde existirem |

### 2.2 Regras automáticas (`ComplianceFinding`)

| Código | Detecção | Severidade padrão |
|---|---|---|
| `NOT_ORIGINAL_DECLARED` | Declaração "não original" | blocking |
| `MUSIC_UNKNOWN` | Declaração de música desconhecida | blocking (YT) / warning |
| `POSSIBLE_FOREIGN_WATERMARK` | Varredura visual de quadros | warning (blocking se confiança alta) |
| `POSSIBLE_FOREIGN_ORIGIN` | Metadados do arquivo indicam download de outra rede | warning |
| `DUPLICATE_UPLOAD` | SHA-256 já existente na marca | warning |
| `ALREADY_PUBLISHED_ON_ACCOUNT` | Tentativa de nova publicação do mesmo conteúdo na mesma conta | blocking (exige ação explícita "republicar") |
| `UNVERIFIED_CLAIM` / `CONTRADICTED_CLAIM` | Fact-check | warning / blocking |
| `UNSOURCED_FACT_PATTERN` | Texto gerado contém data/valor/"oficial" sem fonte | warning |
| `HASHTAG_LIMIT` / `TEXT_LIMIT` | Validador de texto por plataforma | blocking |
| `HASHTAG_IRRELEVANT` | Hashtag sem relação com jogo/categoria (lista de bloqueio + IA) | warning |
| `AI_LABEL_REQUIRED` | Declaração "IA realista" e campo de rótulo desmarcado | blocking |
| `BRANDED_CONTENT_REQUIRED` | Declaração "patrocinado" e toggle desmarcado | blocking |
| `FORMAT_NOT_ELIGIBLE` | Ex.: vídeo > 90 s para Facebook Reels; > 3 min para Shorts | blocking |
| `ACCOUNT_DAILY_LIMIT` | Agendamento excede limite diário conhecido | warning |
| `MIN_SPACING` | Dois posts muito próximos na mesma conta | info |
| `PUBLISHER_POLICY_NOTE` | Jogo com observação cadastrada (ex.: "publisher X proíbe monetizar spoilers") | warning |

Alertas `blocking` só podem ser superados por `approver`/`admin` com **justificativa escrita**, registrada em `Approval.acceptedFindingIds` e no `AuditLog` (exceto `TEXT_LIMIT`/`FORMAT_NOT_ELIGIBLE`, que são técnicos e não podem ser aceitos).

### 2.3 Salvaguardas anti-spam embutidas

- Não existe publicação sem aprovação humana.
- Uma publicação por conteúdo/conta/formato (constraint única no banco).
- Espaçamento mínimo configurável entre posts da mesma conta.
- Sem rotação de contas, sem contas múltiplas para a mesma audiência, sem republicar conteúdo de terceiros.
- Textos variam por plataforma (não é o mesmo texto colado em todas).

Regras ligadas à monetização (`NEWS_NEEDS_COMMENTARY`, `GAMEPLAY_COMMERCIAL_RIGHTS`, `MONETIZATION_DURATION_HINT`, `SHORTS_MUSIC_CLAIM_RISK`) estão em [20 §2](20-monetizacao.md).

## 3. Catálogo de políticas por jogo/publisher

`Game` ganha (via `externalRef`/`Setting`) campo de observações de política do publisher (link da política de vídeos/streaming do publisher, se permite monetização, restrições de spoiler/embargo). O editor vê isso ao subir um conteúdo daquele jogo. Preenchimento é manual e responsabilidade editorial.

## 4. Revisão periódica

- A cada trimestre (ou quando uma plataforma anunciar mudanças): revisar `07-integracoes/*`, `VideoConstraints`, `textRules` e esta tabela; registrar a data de revisão em cada documento.
- Assinar changelogs oficiais: Meta Graph API changelog, TikTok for Developers changelog, YouTube Data API revision history.
