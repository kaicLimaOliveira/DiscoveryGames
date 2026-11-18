# Central Inteligente de Automação de Conteúdo — Documentação de planejamento

> Etapa de planejamento e engenharia (sem código de implementação). Data de referência: **2026-11-15**.
> Objetivo: permitir que outro desenvolvedor ou agente de IA implemente o projeto sem redescobrir as decisões.

## Como ler

1. [00 — Visão geral](00-visao-geral.md): o que é, objetivos, não-objetivos, decisões principais.
2. [03 — Arquitetura](03-arquitetura.md) e [06 — Fluxos](06-fluxos.md): como o sistema funciona.
3. [07 — Integrações](07-integracoes/00-estrategia-e-abstracao.md): o que as APIs oficiais permitem de fato.
4. [17 — Roadmap e critérios de aceite](17-roadmap-e-criterios-de-aceite.md): por onde começar.

## Índice (mapeado aos 20 itens pedidos)

| # | Item pedido | Documento |
|---|---|---|
| 1 | Visão geral do produto | [00-visao-geral.md](00-visao-geral.md) |
| 2 | Requisitos funcionais | [01-requisitos-funcionais.md](01-requisitos-funcionais.md) |
| 3 | Requisitos não funcionais | [02-requisitos-nao-funcionais.md](02-requisitos-nao-funcionais.md) |
| 4 | Arquitetura proposta | [03-arquitetura.md](03-arquitetura.md) |
| 5 | Justificativa das tecnologias | [04-tecnologias.md](04-tecnologias.md) |
| 6 | Diagramas de arquitetura | [03-arquitetura.md](03-arquitetura.md) (contexto, containers, módulos, sequência) |
| 7 | Diagramas dos fluxos de processamento | [06-fluxos.md](06-fluxos.md) |
| 8 | Modelagem inicial do banco | [05-modelo-de-dados.md](05-modelo-de-dados.md) |
| 9 | Estratégia de integração com cada plataforma | [07-integracoes/00-estrategia-e-abstracao.md](07-integracoes/00-estrategia-e-abstracao.md) |
| 10 | Autenticação e autorização | [08-autenticacao-autorizacao.md](08-autenticacao-autorizacao.md) |
| 11 | Estratégia dos agentes de IA | [09-estrategia-ia.md](09-estrategia-ia.md) |
| 12 | Pipeline audiovisual | [10-pipeline-audiovisual.md](10-pipeline-audiovisual.md) |
| 13 | Agendamento | [11-agendamento.md](11-agendamento.md) |
| 14 | Monitoramento | [12-monitoramento.md](12-monitoramento.md) |
| 15 | Segurança | [13-seguranca.md](13-seguranca.md) |
| 16 | Testes | [14-testes.md](14-testes.md) |
| 17 | Custos estimados | [15-custos.md](15-custos.md) |
| 18 | Riscos e limitações | [16-riscos-e-limitacoes.md](16-riscos-e-limitacoes.md) |
| 19 | Roadmap | [17-roadmap-e-criterios-de-aceite.md](17-roadmap-e-criterios-de-aceite.md) |
| 20 | Critérios de aceite por etapa | [17-roadmap-e-criterios-de-aceite.md](17-roadmap-e-criterios-de-aceite.md) |
| — | Análise das APIs oficiais | [instagram](07-integracoes/instagram.md) · [facebook](07-integracoes/facebook.md) · [tiktok](07-integracoes/tiktok.md) · [youtube](07-integracoes/youtube.md) |
| — | Originalidade e políticas | [18-originalidade-e-politicas.md](18-originalidade-e-politicas.md) |
| — | Painel administrativo (telas) | [19-painel-administrativo.md](19-painel-administrativo.md) |
| — | Monetização (programas, requisitos, impacto no projeto) | [20-monetizacao.md](20-monetizacao.md) |
| — | Deploy na VPS (runbook) | [runbooks/deploy.md](runbooks/deploy.md) |
| — | App Meta: System User, token e teste de Live (runbook do dono) | [runbooks/meta-app.md](runbooks/meta-app.md) |
| — | Google OAuth e YouTube (runbook do dono) | [runbooks/google-oauth.md](runbooks/google-oauth.md) |
| — | Escopo v2: organizações e cortador (design) | [superpowers/specs/2026-11-17-organizacoes-e-cortador-design.md](superpowers/specs/2026-11-17-organizacoes-e-cortador-design.md) |
| — | Débitos técnicos e ideias adiadas | [21-debitos-tecnicos.md](21-debitos-tecnicos.md) |
| — | Planos de implementação | [superpowers/plans/](superpowers/plans/) |
| — | Decisões (ADRs; 0008 cortador híbrido, 0009 organizações e contas, 0010 trava de direitos) | [adr/](adr/) |
| — | Fontes de preços | [_pesquisa/custos-infra-fontes.md](_pesquisa/custos-infra-fontes.md) |
| — | Fontes de monetização | [_pesquisa/monetizacao-fontes.md](_pesquisa/monetizacao-fontes.md) |

## Convenções

- **✅ Confirmado** (documentação oficial, com link) · **🔒 Depende de aprovação** · **❓ Hipótese a validar**. As análises de API foram feitas lendo as páginas oficiais em 15/11/2026; páginas que não puderam ser lidas estão indicadas. **Reconfira os trechos citados antes de implementar cada adaptador** — essas APIs mudam com frequência.
- Diagramas em Mermaid (renderizam no GitHub, GitLab e VS Code).
- Hipóteses consolidadas: [16 §5](16-riscos-e-limitacoes.md).

## Glossário

| Termo | Significado |
|---|---|
| Organização (`Organization`, antes `Brand`) | Uma página/canal de nicho com suas contas sociais, membros e configurações. O painel suporta várias |
| Fonte (`Source`) | O vídeo longo que o cortador analisa, com declaração de direitos obrigatória |
| Corte (`Clip`) | Trecho renderizado de uma fonte; vira uma publicação por rede |
| Conteúdo (`Content`) | Um vídeo original e seus metadados |
| Rendition | Versão derivada do original para uma plataforma/formato |
| Publicação (`Publication`) | Um conteúdo em uma conta social em um formato — unidade de aprovação, agendamento e publicação |
| Adaptador | Módulo que implementa `PlatformAdapter` para uma rede |
| Passthrough / remux / transcode | Usar o original / trocar só o container / recodificar |
| Reconciliação | Verificar na plataforma se um post existe quando o resultado de uma chamada foi incerto |
| Manual assistido | Modo em que a central prepara tudo e uma pessoa posta no app da rede, colando o link depois |
