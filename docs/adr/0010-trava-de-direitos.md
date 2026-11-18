# ADR 0010 — Trava de direitos obrigatória em toda fonte

- **Status:** aceito (2026-11-17)
- **Contexto:** o cortador transforma vídeos longos, que podem ser de terceiros, em cortes publicáveis. Publicar corte de fonte sem direitos é anti-objetivo do produto: arrisca as contas, a monetização e a Central ([18](../18-originalidade-e-politicas.md), [20](../20-monetizacao.md)). O dono escolheu a trava de direitos (e não um "modo comentário"). Spec: [§5.2](../superpowers/specs/2026-11-17-organizacoes-e-cortador-design.md).
- **Decisão:** toda fonte tem uma **declaração de direitos obrigatória**:

  | Declaração | O que se exige |
  |---|---|
  | `own` | Aceite do usuário |
  | `authorized` | Nome do criador e evidência (anexo ou link) |
  | `cc_license` | Link da fonte e tipo de licença |
  | `clipper_program` | Link do programa ou das regras |
  | `none` | Cortes podem ser gerados para estudo, **nunca publicados** |

  - **Regras no servidor**, não só na UI: a publicação de corte de fonte `none` é recusada pela API; o **download** de vídeo de fonte `none` também (senão o download manual furaria a trava); link do YouTube com `none` é recusado **antes** do download.
  - Declaração e evidência vão para a auditoria (quem e quando).
  - **Mudança de declaração** é permitida (por exemplo `none` para `authorized`), exige a evidência da nova categoria, preserva o histórico e é auditada. **Reclassificar para `none` bloqueia na hora** as publicações agendadas que ainda não saíram.
  - Créditos ao criador entram na legenda automaticamente (`authorized`, `cc_license`, `clipper_program`), em formato configurável. Criadores parceiros são cadastrados por organização para reaproveitar a declaração.
- **Alternativas:**
  - **Modo comentário** (trecho de terceiro com narração própria): descartado pelo dono.
  - **Só aviso** na UI, sem bloqueio: não impede o anti-objetivo.
  - **Verificação automática de direitos:** a spec não prevê nenhuma; a declaração é humana.
- **Consequências:**
  - A trava depende de honestidade: a Central registra **quem declarou**, e a responsabilidade é do declarante (risco 5 da spec §10); a UI explica as consequências.
  - Fonte `none` serve para estudo e não gera publicação.
  - Cada ponto de saída (publicar, agendar, baixar) precisa passar pela mesma checagem de servidor.
  - **Estado (Fase 3):** entregues a declaração obrigatória por fonte, as regras por categoria no servidor, o anexo de evidência, os criadores parceiros por organização, o histórico versionado e auditado da declaração (mudança restrita a aprovador e administrador), a recusa do link do YouTube com `none` antes do download e a função `assertPublishable`, que recusa fonte `none`. **Ficam para as Fases 4 e 5:** chamar `assertPublishable` nos pontos de saída (a recusa do download do corte na Fase 4; publicar e agendar na Fase 5), os créditos ao criador na legenda e o bloqueio das publicações agendadas ao reclassificar para `none`, que só fazem sentido quando existirem cortes e agendamentos.
