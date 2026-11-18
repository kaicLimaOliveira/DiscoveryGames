# Design — Organizações e Cortador de vídeos (v2 do escopo)

> Data: 2026-11-17. Origem: sessão de refinamento com o dono do produto.
> Substitui partes de [2026-11-15-central-conteudo-design.md](2026-11-15-central-conteudo-design.md) e do roteiro em [17](../../17-roadmap-e-criterios-de-aceite.md) (ver §9).
> Legenda: **[dono]** = decidido pelo dono do produto; **[call]** = decisão do redator, revisável.

## 1. Intenção e porquê

O dono quer **monetizar várias páginas de nicho** (ex.: GamerDoido — games; outra de academia) nas quatro redes (YouTube, Instagram, Facebook, TikTok), gerenciando todas num só lugar. **[dono]**

A primeira entrega útil é:
1. **Organizações**, cada uma com suas próprias contas de redes sociais vinculadas. **[dono]**
2. Um **cortador de vídeos**, no estilo WayinVideo: recebe um vídeo longo (link do YouTube ou MP4), a IA encontra os melhores trechos, gera cortes verticais e os publica nas contas da organização. **[dono]**

O conteúdo do vídeo não é específico. Pode ser um treino de bíceps ou uma gameplay, então o motor precisa ser genérico. **[dono]**

## 2. Objetivos, não-objetivos e anti-objetivos

### Objetivos (primeira entrega)
- Criar e gerenciar várias **organizações** no mesmo painel. Cada uma tem nome, fuso, idioma, tags do nicho e membros com papéis.
- **Vincular contas** a cada organização:
  - Instagram e Página do Facebook (Meta);
  - canal do YouTube (OAuth);
  - conta do TikTok (só identificação, porque o TikTok é manual assistido).
- **Cortador**: enviar um MP4 ou colar um link do YouTube, receber cortes candidatos com título e legenda por rede, revisar, aprovar e publicar.
- **Publicação automática** no Instagram (Reels), no Facebook (Reels) e no YouTube (Shorts) a partir do primeiro corte aprovado. O TikTok fica em modo manual assistido. **[dono: opção A]**

### Não-objetivos (agora)
- **Modo orgânico** (agente de notícias, posts de feed). Fica registrado como débito técnico D1 em [21-debitos-tecnicos.md](../../21-debitos-tecnicos.md). **[dono]**
- **Grade recorrente e piloto automático** (ADR 0007). Continuam desenhados, mas ficam para depois. A primeira entrega tem "publicar agora" e "agendar data/hora" por corte. **[call]**: o dono não citou a grade no escopo do primeiro mês.
- **Modo comentário** (trecho de terceiro com narração própria). O dono escolheu só a trava de direitos. **[dono]**
- Rastreamento de objetos avançado no reenquadramento. Na primeira entrega o reenquadramento é simples (§5.4).
- Edição manual de vídeo dentro da central, além de ajustar o início e o fim do corte.

### Anti-objetivos (fracasso mesmo "funcionando")
- **Publicar cortes de fontes sem direitos registrados.** A trava de direitos é obrigatória (§5.2). **[dono: opção 1]**
- Publicar sem aprovação humana. Na primeira entrega todo corte é aprovado por uma pessoa. A chave "publicar sem aprovação" pertence ao modo orgânico (D1).
- Publicar em duplicidade na mesma conta.
- Uma organização ver ou publicar nas contas de outra.
- Custo de IA ou de processamento fora de controle. Cada organização tem um orçamento com alerta.

## 3. Restrições

- **Arquitetura existente (Fase 1, já na `main`):** monolito modular em TypeScript, com app Nuxt 4 (painel + API), um processo worker, Postgres + pg-boss, storage S3-compatível, auth com 2FA, RBAC, auditoria, Docker Compose e CI. O desenho se apoia nisso e não troca a stack.
- **Uma VPS** (Hetzner CPX32: 4 vCPU, 8 GB). O FFmpeg roda no worker com concorrência controlada. Limites da primeira entrega **[call]**: vídeo de entrada de até **2 h** e **4 GB**, com no máximo 1 job de renderização por vez e 1 de análise por vez.
- **Download de link do YouTube:** a API oficial não oferece download. Aceitar link exige ferramenta não oficial (yt-dlp), que os termos do YouTube proíbem, e o YouTube costuma bloquear IPs de datacenter. **[call]**: **MP4 é o caminho principal e garantido. O link é uma conveniência "pode falhar"**, só para fontes com direitos registrados, e quando falha a UI pede o MP4.
- **Integrações** (fatos em [07-integracoes](../../07-integracoes/)):
  - YouTube: desde 02/11/2026, projetos não verificados **não** ficam mais restritos a "privado". A auditoria só é necessária para aumentar a cota.
  - Meta: no modo Development os posts só ficam visíveis para quem tem papel no app. Para publicar de verdade, o app precisa estar **Live com Standard Access**. ❓ Confirmar no painel da Meta que isso é possível sem App Review. **Este é o risco nº 1 a validar no início da implementação.**
  - Facebook Reels via API aceitam só vídeos de 3 a 90 s. Limite de 30 Reels por Página a cada 24 h.
  - TikTok continua manual assistido (ADR 0004).
- **Monetização:** cortes de 61 a 90 s são o ponto ideal ([20](../../20-monetizacao.md)). O alvo padrão de duração é configurável por organização, com padrão de **30 a 90 s**.

## 4. Organizações (multi-organização)

- "Organização" é o conceito que o modelo atual chama de `Brand`. **[call]**: renomear para `Organization` no código e na UI agora, enquanto a base é pequena, para evitar dois nomes para a mesma coisa. A tabela `BrandMember` passa a se chamar `OrganizationMember`.
- Cada organização tem:
  - nome;
  - slug;
  - fuso;
  - idioma;
  - **tags do nicho**, usadas pela IA para entender o contexto dos cortes e gerar hashtags (e, no futuro, pelo modo orgânico);
  - guia de voz (texto livre);
  - hashtags fixas;
  - orçamento mensal de IA;
  - membros com papéis (os papéis da Fase 1, por organização).
- O seletor de organização fica no topo do painel. Todas as telas e todas as consultas são filtradas pela organização ativa. O acesso é verificado no servidor, nunca só na UI.
- **Contas vinculadas** (`SocialAccount`: organização, plataforma, identificador externo, nome exibido, status, escopos, credencial cifrada):
  - **[dono]** Em cada organização, o Instagram e a Página do Facebook já estão vinculados entre si na Meta. Não se sabe se organizações diferentes ficam no mesmo Business Manager, por isso o desenho funciona **nos dois casos**.
  - **Meta (IG + FB) [call]:** uma conexão Meta por organização. O padrão é o **System User do Business Manager** que contém aquela Página e aquele IG, conforme a ADR 0005. Organizações em Business Managers diferentes têm System Users diferentes. O token fica cifrado (AES-GCM, como a Fase 1). Plano B, aceito na mesma tela: Page token long-lived obtido pelo login de um admin.
  - **YouTube:** OAuth (web server flow) por canal, com refresh token cifrado.
  - **TikTok:** só o @ da conta, para o modo manual assistido.
- Uma conta externa só pode estar vinculada a **uma** organização. O sistema bloqueia duplicidade pelo identificador externo.

## 5. Cortador

### 5.1 Fluxo

```
Entrada (MP4 ou link) → declarar direitos → baixar/receber → análise técnica (ffprobe)
→ transcrição → amostragem de quadros → IA escolhe trechos → candidatos na tela
→ pessoa revisa (aceita/rejeita/ajusta início-fim) → renderização vertical + legendas
→ versões por rede → aprovação → publicar agora / agendar
```

Os cortes rejeitados não são renderizados. Ajustar o início ou o fim de um corte reaproveita a análise e não chama a IA de novo.

### 5.2 Trava de direitos **[dono]**

Toda fonte (o vídeo longo) tem uma declaração obrigatória:

| Declaração | O que se exige |
|---|---|
| `own` | Conteúdo próprio. Basta o aceite do usuário. |
| `authorized` | Criador autorizou. Exige o nome do criador e uma evidência (anexo ou link: print, e-mail, contrato). |
| `cc_license` | Licença livre. Exige o link da fonte e o tipo de licença. |
| `clipper_program` | Programa de clipadores do criador. Exige o link do programa ou das regras. |
| `none` | Sem direitos. **Os cortes podem ser gerados para estudo, mas nunca vão para publicação** (o botão fica bloqueado e a API recusa). |

- A declaração e a evidência ficam na auditoria (quem declarou e quando).
- **Cortes de fonte `none` [call]:** só podem ser assistidos no painel. **Não dá para baixá-los** nem publicá-los: o download de vídeo é bloqueado pela mesma checagem da publicação, no servidor. Sem isso, o download manual viraria um atalho que fura a trava.
- **Mudança de declaração [call]:** é permitida, por exemplo de `none` para `authorized` quando chega a autorização. Ela exige a evidência da nova categoria, fica versionada (o histórico é preservado) e é auditada. Reclassificar para `none` bloqueia na hora as publicações agendadas que ainda não saíram.
- **Link do YouTube com `none` [call]:** é recusado antes do download. Não se baixa por link conteúdo sem direitos.
- Créditos ao criador original (`authorized` / `cc_license` / `clipper_program`) entram automaticamente na legenda, num formato configurável. **[call]**
- **Criadores parceiros:** cadastro por organização, com nome, canais e autorização anexada, para reutilizar a declaração em fontes futuras. **[call]**

### 5.3 Seleção dos trechos (motor híbrido) **[dono: abordagem 3]**

- **Transcrição:** API de transcrição com timestamps por palavra. **[call]**: Groq Whisper como principal, atrás de uma interface `Transcriber` com fallback, como já previsto em [09](../../09-estrategia-ia.md). Vídeos sem fala geram uma transcrição vazia, e isso é tratado como sinal, não como erro.
- **Sinais técnicos** (FFmpeg): picos de volume, cortes de cena e intensidade de movimento.
- **Amostragem de quadros:** de N em N segundos, com um teto de quadros por vídeo para limitar o custo.
- **IA (Claude):** recebe a transcrição, os sinais e os quadros, mais as tags e o guia de voz da organização. Devolve uma lista estruturada de candidatos. Cada candidato tem:
  - início e fim;
  - nota de "gancho" de 0 a 100;
  - motivo em uma frase;
  - título;
  - legenda por rede (respeitando as regras de texto de cada adaptador);
  - hashtags;
  - sugestão de layout de reenquadramento.

  A saída é validada por schema, e chamadas que falham são repetidas com limite.
- **Parâmetros por pedido:** quantidade alvo de cortes (padrão de 5 a 10), faixa de duração (padrão de 30 a 90 s) e idioma.
- **Custo [call]:**
  - **O que conta:** cada chamada de IA vai para o `CostLedger`. O orçamento mensal da organização (`aiMonthlyBudgetUsd`, padrão **US$ 50**, editável pelo admin da organização) cobre **IA (Claude) e transcrição (Groq)**. A CPU de renderização não entra, porque já está paga na VPS.
  - **Alerta:** em **80%** do orçamento vai um aviso.
  - **Bloqueio:** se a estimativa de uma nova análise passar do saldo, a análise é **bloqueada**. Análises já em andamento terminam, e renderizar e publicar continuam liberados.

### 5.4 Renderização vertical

- Saída em 1080×1920, H.264 + AAC, dentro das restrições de cada rede, com uma versão por rede quando as restrições diferirem (reuso do desenho de [10](../../10-pipeline-audiovisual.md)).
- **Layouts de reenquadramento [call]:**
  1. **Rosto:** detecção de rosto em quadros amostrados e um recorte 9:16 com trajetória suavizada. É o padrão quando há uma pessoa em cena, como no treino.
  2. **Centro:** recorte central fixo.
  3. **Jogo + facecam:** a tela do jogo em cima e a facecam embaixo. A posição da facecam é detectada ou marcada pelo usuário uma vez por fonte.
  4. **Vídeo inteiro com fundo desfocado:** o vídeo 16:9 centralizado sobre um fundo desfocado.

  A IA sugere o layout e o usuário pode trocar antes de renderizar.
- **Legenda queimada opcional:** palavra a palavra, a partir da transcrição, com estilo por organização (fonte, cor e posição). Fica ligada por padrão quando há fala. **[call]**
- **O original nunca é alterado.** Os cortes são arquivos novos no storage.

### 5.4.1 Retenção de arquivos [call]

O storage é o bucket S3-compatível externo já previsto (Cloudflare R2 em produção), não o disco da VPS. O disco da VPS guarda só arquivos temporários de processamento, que são apagados ao fim de cada job.

| Arquivo | Retenção |
|---|---|
| Original da fonte | 30 dias após o último corte publicado, ou 14 dias se nenhum corte for aceito. Depois disso a fonte fica `expired`: os metadados e a transcrição permanecem, o vídeo é apagado. |
| Cortes renderizados (versões por rede) | 90 dias após a publicação. |
| Hash dos cortes e registros de publicação | Para sempre, para a checagem de duplicidade e a auditoria. |

Os prazos são configuráveis por organização.

### 5.5 Publicação

- **Duas etapas humanas [call]:**
  1. **Aceitar** o candidato, o que dispara a renderização (gasta CPU).
  2. **Aprovar** o corte renderizado e os textos por rede, o que libera a publicação. Assim a pessoa vê o vídeo final e o texto antes de sair.

  As duas podem ser feitas pela mesma pessoa, porque o uso é interno. **Aprovar** exige o papel de aprovador ou de admin da organização, os papéis da Fase 1. O editor só aceita candidatos e edita textos.
- Cada corte aprovado vira uma publicação por rede selecionada. Usa a state machine, a idempotência e a reconciliação já desenhadas em [06](../../06-fluxos.md) e [11](../../11-agendamento.md), e o adaptador `PlatformAdapter` da Fase 1.
- Ações disponíveis: "Publicar agora" ou "Agendar" (data e hora no fuso da organização).
- Cortes acima de 90 s ficam bloqueados para o Facebook, com um aviso.
- Na aba do TikTok: "Baixar vídeo", "Copiar texto", o checklist do app e o campo "Colar URL do post".
- Vídeo e texto também podem ser baixados para qualquer rede. Isso serve de fallback manual. **[call]**
- **Volume e cotas [dono: o volume varia conforme a configuração de cada organização e página]:**
  - Cada conta vinculada tem um **limite diário configurável** de publicações.
  - A central controla as cotas das plataformas:
    - YouTube: **100 uploads (`videos.insert`) por dia por projeto do Google**, num bucket próprio, mais 10.000 unidades por dia para os outros métodos. Os dois limites são compartilhados por todas as organizações (regra vigente desde 01/06/2026, conforme [youtube.md](../../07-integracoes/youtube.md) §10; corrigido em 2026-11-18, porque a versão anterior deste texto usava a regra antiga, de cerca de 6 uploads por dia);
    - Facebook: 30 Reels por Página a cada 24 h;
    - Instagram: o limite de publicação por conta.
  - Antes de publicar ou agendar, a central confere o saldo. O que não cabe na cota do dia fica na fila para o próximo período, com aviso, em vez de falhar. Isso usa a `QuotaUsage` já desenhada.
  - **[call]:** com 100 uploads por dia por projeto, o pedido de aumento de cota (auditoria) só é necessário se o volume somado das organizações se aproximar desse teto. O painel avisa quando o uso passar de 80% do limite diário.
- **Duplicidade:** o mesmo corte (mesmo hash de vídeo) não pode ser publicado duas vezes na mesma conta. Republicar exige uma ação explícita, que fica registrada na auditoria.

## 6. Telas (primeira entrega)

```
┌──────────────┬───────────────────────────────────────────────────────────┐
│ [GamerDoido▾]│                                                           │
│ Cortes       │  [+ Novo corte]  (MP4 / link do YouTube)                  │
│ Publicações  │  Fonte: "Live 12/11" · direitos: próprio · 8 candidatos   │
│ Contas       │  ┌ ▶ 0:42 Boss em 1 hit   gancho 92  layout: jogo+cam ┐   │
│ Configurações│  │ [Aceitar] [Rejeitar] [Ajustar início/fim]          │   │
│              │  └────────────────────────────────────────────────────┘   │
└──────────────┴───────────────────────────────────────────────────────────┘
```

- **Cortes:** lista de fontes. Cada fonte tem status de processamento, os candidatos com player, a nota e o motivo, e as ações aceitar, rejeitar e ajustar.
- **Publicações:** os cortes aprovados por rede, com status, editor de texto por rede, publicar agora ou agendar, e um calendário simples em lista.
- **Contas:** contas vinculadas da organização, com o status de cada uma, conectar, desconectar e a validade do token.
- **Configurações da organização:** tags, guia de voz, hashtags fixas, créditos, estilo da legenda, duração padrão dos cortes, orçamento e criadores parceiros.
- **Organizações** (admin global): criar organizações e gerenciar membros.

## 7. Modelo de dados (delta sobre [05](../../05-modelo-de-dados.md))

| Entidade | Mudança |
|---|---|
| `Brand` → `Organization` | Renomear. Novos campos: `tags`, `voiceGuide`, `fixedHashtags`, `creditTemplate`, `captionStyle`, `clipDefaults` e `aiMonthlyBudgetUsd`. |
| `BrandMember` → `OrganizationMember` | Renomear. |
| `SocialAccount` | Já previsto. Fica por organização, com unicidade (`platform`, `externalId`) e credencial cifrada. |
| `Source` (novo) | O vídeo longo. Campos: organização, tipo (`upload` / `youtube_link`), URL, `MediaAsset` original, declaração de direitos, evidência, `partnerCreatorId?` e status do processamento. |
| `PartnerCreator` (novo) | Criador parceiro por organização: nome, canais e autorização. |
| `ClipCandidate` (novo) | Campos: fonte, início e fim, nota, motivo, layout, textos sugeridos e status (`suggested` / `accepted` / `rejected` / `rendered`). |
| `Clip` | Corte renderizado. Campos: candidato, `MediaAsset` por rede e hash. É a unidade que vira `Publication`. |
| `Transcript`, `MediaProbe`, `AiRun`, `CostLedger`, `Publication`, `PublishAttempt`, `Approval` | Já desenhados. São reaproveitados como estão. |

## 8. Abordagens consideradas

| Abordagem | Trade-off | Decisão |
|---|---|---|
| 1. Motor próprio completo (transcrição, detecção, rastreamento e reenquadramento, tudo feito por nós) | Controle total e custo baixo por corte, mas leva meses para chegar a uma qualidade comparável, principalmente no rastreamento em gameplay | Descartada |
| 2. API de cortes de terceiros (ex.: Vizard, Klap, com preço e termos a confirmar) | Rápida e com qualidade alta, mas o custo é por minuto, há dependência de fornecedor e pouco controle | **Plano B** se a qualidade do híbrido não bastar |
| 3. **Híbrido**: o worker existente orquestra uma API de transcrição, o Claude escolhe os trechos e o FFmpeg corta e reenquadra com layouts simples | Custo baixo, sem fornecedor de cortes e reaproveita a Fase 1. Os primeiros cortes ficam razoáveis, e a qualidade melhora por etapas | **Escolhida [dono]** |

Download por link: **MP4 é o caminho principal e o link é "pode falhar"** **[call]**, pelos termos do YouTube e pelo bloqueio de IPs de datacenter (§3).

## 9. Impacto no que já existe

- **Código da Fase 1:** continua válido. A única migração estrutural é renomear `Brand` → `Organization` (§4).
- **Documentos a atualizar quando o plano for executado:**
  - [00](../../00-visao-geral.md): sai o não-objetivo "edição de vídeo criativa (cortes)". O cortador entra no escopo, e entram a multi-organização e a trava de direitos.
  - [17](../../17-roadmap-e-criterios-de-aceite.md) e [15](../../15-custos.md): o roteiro passa a ser:
    - Fase 2: organizações e contas;
    - Fase 3: cortador (análise e candidatos);
    - Fase 4: renderização;
    - Fase 5: publicação (IG, FB e YouTube automáticos, TikTok manual).

    As fases antigas de "IA de metadados" e "processamento" ficam absorvidas pelo cortador. Grade e piloto automático, métricas e modo orgânico vêm depois.
  - Novas ADRs:
    - 0008: cortador híbrido;
    - 0009: organizações e contas por organização;
    - 0010: trava de direitos.
- **ADR 0007 (grade e fila):** continua válida para uma fase posterior.

## 10. Riscos

1. **Meta Live sem App Review** (❓). **Validar primeiro.** Se não for possível, o IG e o FB caem para manual assistido (D2) e o pedido de App Review começa imediatamente. **[call]:** nesse caso, o critério de aceite de publicação real no IG e no FB vira "publicação manual assistida funcionando, com o adaptador Meta pronto atrás de uma chave e testado contra contas com papel no app". A automação liga quando a Meta aprovar.
2. **Qualidade dos cortes** em gameplay sem fala. Mitigação: sinais técnicos, layouts escolhíveis e o plano B (API de terceiros).
3. **Link do YouTube bloqueado** no IP da VPS. Mitigação: MP4 é o caminho principal.
4. **CPU da VPS** com vídeos longos. Mitigação: limites de 2 h e 4 GB, concorrência 1 e fila. Se precisar, entra um worker de mídia dedicado.
5. **Declaração de direitos falsa** feita pelo usuário. A central registra quem declarou. A responsabilidade é do declarante, e a UI explica as consequências.

## 11. Critérios de aceite da primeira entrega

- Um admin cria duas organizações e vincula a cada uma o seu IG, a sua Página do FB, o seu canal do YouTube e o @ do TikTok. Uma organização não vê nada da outra (testado na API).
- Um MP4 de 30 a 60 min com fala gera pelo menos 5 candidatos com título e legenda por rede em menos de 15 min na VPS de referência.
- Uma gameplay sem fala gera candidatos usando os sinais técnicos.
- Uma fonte `none` gera cortes, mas a API recusa a publicação (teste).
- Um corte aceito é renderizado em 1080×1920 com legenda queimada e layout escolhido, e o original fica intacto (hash igual).
- Um corte aprovado é publicado de verdade no IG, no FB e no YouTube das contas vinculadas, sem duplicar mesmo com retry.
- Quando a cota do dia acaba (simulada em teste), as publicações seguintes ficam na fila para o próximo período, com aviso, e não falham. O TikTok fica com download e cópia do texto e com o registro da URL.
- O custo de IA de cada fonte aparece no `CostLedger`, e o orçamento estourado bloqueia novas análises.

## 12. O que fica para quem constrói

- A biblioteca exata de detecção de rosto (ex.: um modelo leve rodando no worker) e o algoritmo de suavização da trajetória.
- Os limiares dos sinais técnicos, a frequência de amostragem de quadros e o formato do prompt (versionado, como em [09](../../09-estrategia-ia.md)).
- A estratégia de upload multipart direto ao storage para arquivos de até 4 GB.
- A ordem interna das tarefas dentro de cada fase, os testes e os fixtures (vídeos curtos de teste com e sem fala).
