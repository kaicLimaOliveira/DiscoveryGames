# 01 — Requisitos funcionais

Convenção: `RF-<área>-<nº>`. Prioridade: **M** (obrigatório no MVP, até a Fase 8), **S** (desejável), **F** (futuro).
A coluna "Fase" referencia o [roadmap](17-roadmap-e-criterios-de-aceite.md).

## 1. Recebimento de conteúdo (RF-ING)

| ID | Requisito | Prior. | Fase |
|---|---|---|---|
| RF-ING-01 | Upload de vídeo pelo painel, com upload direto ao storage (URL pré-assinada, multipart para arquivos grandes) e barra de progresso | M | 2 |
| RF-ING-02 | Cadastro do conteúdo com: nome, categoria, jogo, descrição/contexto, roteiro opcional, data de criação (automática), status | M | 2 |
| RF-ING-03 | **O arquivo original nunca é modificado nem sobrescrito.** Armazenado em chave imutável, com hash SHA-256 registrado | M | 2 |
| RF-ING-04 | Detecção de duplicidade: se o hash SHA-256 já existir na marca, avisar e permitir vincular ao conteúdo existente | S | 2 |
| RF-ING-05 | Declaração de direitos no upload: conteúdo original? gameplay autorizado? origem da música? contém IA generativa realista? | M | 2 |
| RF-ING-06 | Pasta monitorada (ex.: bucket/prefixo `inbox/` ou pasta sincronizada) que cria conteúdos automaticamente em status "aguardando dados" | F | 10 |
| RF-ING-07 | Endpoint de API autenticado (token de serviço) para criar conteúdo a partir de outra ferramenta | F | 10 |
| RF-ING-08 | Integração com armazenamento em nuvem (Google Drive etc.) | F | 10 |

## 2. Análise técnica e de conteúdo (RF-ANA)

| ID | Requisito | Prior. | Fase |
|---|---|---|---|
| RF-ANA-01 | Extrair com ffprobe: resolução, proporção, duração, FPS (inclusive VFR), codecs de vídeo/áudio, bitrate, canais/sample rate, tamanho, rotação, metadados de container | M | 3 |
| RF-ANA-02 | Validar arquivo: container suportado, stream de vídeo presente, arquivo não corrompido (decodificação de amostra), limites mínimos | M | 3 |
| RF-ANA-03 | Transcrever áudio (pt-BR por padrão) com timestamps | M | 4 |
| RF-ANA-04 | IA identifica contexto: resumo, tipo de conteúdo (gameplay, curiosidade, notícia, review, humor…), jogo(s), entidades, tom, público | M | 4 |
| RF-ANA-05 | IA lista **afirmações factuais** presentes no vídeo/contexto que precisam de verificação | M | 4 |
| RF-ANA-06 | Verificação factual assistida (busca na web com citações) quando o tipo for notícia ou houver afirmações factuais; resultado exibido ao aprovador | M | 4 |
| RF-ANA-07 | IA sugere oportunidades de engajamento (pergunta para comentários, gancho, CTA) e melhorias de publicação | S | 4 |
| RF-ANA-08 | Detecção heurística de marca d'água de outras plataformas em quadros amostrados | S | 3/4 |

## 3. Processamento audiovisual (RF-VID)

| ID | Requisito | Prior. | Fase |
|---|---|---|---|
| RF-VID-01 | Perfis de saída por plataforma/formato (preset versionado) definidos a partir das especificações oficiais | M | 3 |
| RF-VID-02 | Decidir por perfil: **reaproveitar o original**, **remux** (sem recompressão) ou **transcode** — evitando recompressão desnecessária | M | 3 |
| RF-VID-03 | Gerar versão (rendition) por perfil; perfis idênticos compartilham o mesmo arquivo (deduplicação) | M | 3 |
| RF-VID-04 | Validar cada rendition contra as regras da plataforma de destino antes de liberar para aprovação | M | 3 |
| RF-VID-05 | Gerar thumbnails/capas candidatas (quadros) | S | 3 |
| RF-VID-06 | Normalização de loudness opcional (desligada por padrão; apenas alerta se muito fora do alvo) | S | 3 |
| RF-VID-07 | Adaptar vídeos não verticais (pad/crop) apenas sob escolha explícita do usuário | S | 3 |
| RF-VID-08 | Histórico de processamento por conteúdo (passos, duração, erros, comandos/presets usados) | M | 3 |

## 4. Metadados com IA (RF-COP)

| ID | Requisito | Prior. | Fase |
|---|---|---|---|
| RF-COP-01 | Gerar textos por plataforma: IG (legenda + hashtags), FB (descrição + hashtags quando apropriado), TikTok (legenda/título + hashtags), YouTube (título + descrição + tags/hashtags) | M | 4 |
| RF-COP-02 | Respeitar limites de cada plataforma (caracteres, nº de hashtags) com validação determinística após a geração | M | 4 |
| RF-COP-03 | Não inventar fatos: textos só podem usar informações do contexto, transcrição ou verificação factual aprovada | M | 4 |
| RF-COP-04 | Edição manual de todos os textos, com histórico de versões (IA vs humano) | M | 4 |
| RF-COP-05 | Regenerar texto de **uma** plataforma com instrução ("mais curto", "sem emojis", "tom mais sério") | M | 4 |
| RF-COP-06 | Guia de voz da marca configurável (tom, termos proibidos, hashtags fixas, CTA padrão) | M | 4 |
| RF-COP-07 | Sugerir 2–3 variações de título/gancho | S | 4 |

## 5. Aprovação (RF-APR)

| ID | Requisito | Prior. | Fase |
|---|---|---|---|
| RF-APR-01 | Central de aprovação: ver vídeo de cada versão, textos, alertas e checagem factual lado a lado | M | 4–5 |
| RF-APR-02 | Aprovar, rejeitar ou solicitar alterações **por plataforma** | M | 5 |
| RF-APR-03 | Nada é publicado sem aprovação registrada (usuário, data, versão exata do texto e do vídeo aprovados) | M | 5 |
| RF-APR-04 | Qualquer edição após a aprovação invalida a aprovação daquela publicação | M | 5 |
| RF-APR-05 | Alertas de severidade "bloqueante" impedem aprovar até serem resolvidos ou explicitamente aceitos com justificativa | M | 5 |
| RF-APR-06 | Atender requisitos de UX exigidos pela rota de API usada no momento de postar (ex.: a Content Posting API do TikTok exige escolha explícita de privacidade e exibição da conta de destino; a Accounts API não tem esses requisitos conhecidos — ver [tiktok.md](07-integracoes/tiktok.md)) | M | 7 |
| RF-APR-08 | **Aprovar todas as redes com um clique** (quando não houver alerta bloqueante em nenhuma) e **aprovação em lote** de vários conteúdos; ao aprovar, o conteúdo entra na fila automática (RF-AGE-08). Cada aprovação continua registrada por publicação (RF-APR-03) | M | 5 (1 clique) / 8 (lote + fila) |
| RF-APR-07 | Modo **manual assistido** por publicação: central prepara vídeo e texto, pessoa posta no app e cola a URL | M | 5 (genérico) / 7 |

## 6. Publicação (RF-PUB)

| ID | Requisito | Prior. | Fase |
|---|---|---|---|
| RF-PUB-01 | Publicar via API oficial: Instagram, Facebook, YouTube. TikTok em modo manual assistido (RF-APR-07) | M | 5–7 |
| RF-PUB-08 | Vídeos acima de 90 s não podem ser selecionados para Facebook Reels (bloqueio `FORMAT_NOT_ELIGIBLE` com explicação) | M | 5 |
| RF-PUB-02 | Cada plataforma é independente: falha em uma não impede as demais | M | 5 |
| RF-PUB-03 | Registrar resultado individual (ID externo, URL, status, erro, tentativas) | M | 5 |
| RF-PUB-04 | Retentar com backoff apenas falhas transitórias; nunca duplicar post já concluído (idempotência) | M | 5 |
| RF-PUB-05 | Reconciliação: quando o resultado é incerto (timeout), verificar na plataforma antes de retentar | M | 5 |
| RF-PUB-06 | Verificar pré-condições antes de publicar: token válido, cota disponível, rendition válida, aprovação vigente | M | 5 |
| RF-PUB-07 | Conectar/desconectar contas via OAuth oficial | M | 5–7 |

## 7. Agendamento (RF-AGE)

| ID | Requisito | Prior. | Fase |
|---|---|---|---|
| RF-AGE-01 | Publicar imediatamente | M | 5 |
| RF-AGE-02 | Agendar data/hora, com horário diferente por rede | M | 8 |
| RF-AGE-03 | Pausar, retomar e cancelar agendamentos | M | 8 |
| RF-AGE-04 | Reprocessar/retentar publicações com falha manualmente | M | 8 |
| RF-AGE-05 | Timezone configurável por marca (padrão America/Sao_Paulo) | M | 8 |
| RF-AGE-06 | Sugerir horários a partir do histórico de desempenho | F | 10 |
| RF-AGE-07 | **Grade recorrente por conta social** (semanal: dias × horários; ou intervalo: a cada N h dentro de uma janela), com início/fim/pausa e validação contra limites diários e espaçamento ([11 §7.2](11-agendamento.md)) | M | 8 |
| RF-AGE-08 | **Fila de conteúdos aprovados** ordenável (arrastar), com fixar em horário, prioridade urgente e validade (notícias) ([11 §7.3](11-agendamento.md)) | M | 8 |
| RF-AGE-09 | **Alocação automática**: cada horário da grade recebe o próximo conteúdo elegível da fila para aquela conta; horizonte de 7 dias, visível no calendário; congelamento a 60 min do horário ([11 §7.4](11-agendamento.md)) | M | 8 |
| RF-AGE-10 | Conteúdo inelegível para uma rede (ex.: > 90 s no FB) é pulado só naquela rede | M | 8 |
| RF-AGE-11 | Alertas `QUEUE_LOW`, `SLOT_UNFILLED`, `QUEUE_ITEM_EXPIRED`, `SCHEDULE_EXCEEDS_LIMIT` ([11 §7.5](11-agendamento.md)) | M | 8 |
| RF-AGE-12 | Fila vazia nunca gera repost de conteúdo antigo | M | 8 |

## 8. Métricas (RF-MET)

| ID | Requisito | Prior. | Fase |
|---|---|---|---|
| RF-MET-01 | Coletar periodicamente as métricas que cada API oferecer (views, curtidas, comentários, compartilhamentos, salvamentos, alcance, retenção, tempo médio, seguidores/inscritos) — **somente as disponíveis** | M | 9 |
| RF-MET-02 | Guardar série temporal (snapshots) por publicação | M | 9 |
| RF-MET-03 | Comparativos por plataforma, jogo, categoria, tipo de conteúdo, dia/horário | M | 9 |
| RF-MET-04 | Indicar claramente quando uma métrica não é fornecida por uma plataforma (nunca exibir zero no lugar de "indisponível") | M | 9 |
| RF-MET-05 | Relatório semanal com recomendações geradas por IA a partir dos dados | S | 10 |

## 9. Painel administrativo (RF-UI)

| ID | Tela | Itens | Prior. | Fase |
|---|---|---|---|---|
| RF-UI-01 | Dashboard | publicados, agendados, falhas, views acumuladas, desempenho por plataforma, top conteúdos | M | 9 (parcial na 5) |
| RF-UI-02 | Biblioteca | upload, categorias, jogos, busca, filtros, histórico de processamento | M | 2–3 |
| RF-UI-03 | Editor de publicações | player, título, legenda, hashtags, metadados por plataforma, seleção de redes | M | 4 |
| RF-UI-04 | Calendário editorial | visão mensal/semanal, arrastar para reagendar, cor por plataforma | M | 8 |
| RF-UI-05 | Central de aprovação | versões, aprovar/rejeitar/pedir alteração, publicar agora, agendar | M | 5 |
| RF-UI-06 | Configurações | contas conectadas, credenciais (status, nunca o valor), horários, preferências, provedores de IA, orçamento de IA, usuários | M | 1–8 |
| RF-UI-07 | Saúde do sistema | filas, jobs com falha, cotas por plataforma, expiração de tokens, custos do mês | M | 5–9 |

## 10. Administração e acesso (RF-ADM)

| ID | Requisito | Prior. | Fase |
|---|---|---|---|
| RF-ADM-01 | Login com e-mail e senha; sessões seguras; 2FA (TOTP) obrigatório para `admin` e `approver` | M | 1 |
| RF-ADM-02 | Papéis: `admin` (tudo), `editor` (sobe, edita, envia p/ aprovação), `approver` (aprova/publica), `viewer` (leitura) | M | 1 |
| RF-ADM-03 | Log de auditoria de ações sensíveis (aprovar, publicar, conectar conta, alterar configurações) | M | 1 |
| RF-ADM-04 | Múltiplas marcas (páginas) com contas próprias; usuário pode ter acesso a uma ou mais | S | 1 (modelo) / 10 (UI) |
