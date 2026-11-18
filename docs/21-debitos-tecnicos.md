# 21 — Débitos técnicos e ideias registradas

> Itens decididos, mas adiados pelo dono do produto. Cada um guarda o que já foi combinado, para que ninguém precise redescobrir o contexto quando o item voltar à fila.

## D1 — Modo orgânico (agente de notícias + posts de feed)

**Registrado em:** 2026-11-17, na sessão de refinamento. **Estado:** adiado pelo dono ("só quero que fique registrado como débito técnico").

**Ideia:** um modo que se liga e desliga **por organização**. Nele, um agente busca notícias do nicho a partir das **tags** da organização e cria posts de **feed** para o Instagram e o Facebook. O objetivo inclui **velocidade**: postar a notícia minutos depois de ela sair, antes dos outros veículos.

**Já decidido:**
- **Duas trilhas:**
  - **Grade:** posts do nicho sem urgência, como curiosidades, listas e lançamentos, preenchem os horários fixos da grade (ex.: de 8 em 8 h). O formato é o **carrossel** com resumo.
  - **Plantão:** a notícia quente **fura a grade** e sai na hora. O formato é o **card com o modelo visual da marca** mais a manchete, gerado em segundos.
- Os modelos visuais de card e carrossel ficam **por organização**.
- **Aprovação:**
  - Todo post cai numa fila para aprovação **um a um**.
  - No plantão chega um aviso no celular (Telegram) com prévia e botão "Publicar".
  - Uma chave **"publicar sem aprovação prévia"** vale **por organização e por rede**.
  - Mesmo com a chave ligada, nunca saem sozinhos rumores, fatos marcados como duvidosos pela checagem nem notícias sem confirmação. O post só sai sozinho com **fonte oficial** ou **≥ 2 fontes independentes**.
- **O agente trabalha adiantado:** prepara os próximos 2 ou 3 horários da grade. Um horário sem aprovação (com a chave desligada) fica vazio e gera um aviso. **Nunca há repost.**
- **Prioridade na grade:** o conteúdo próprio vem primeiro, e o orgânico só preenche os horários vazios.
- **Fontes:** a fonte não importa, pode ser blog, Google, X ou outra. O que vale é **rapidez e confiabilidade**. Cada fonte é um **conector** que se liga e desliga, com nota de confiança: oficial, imprensa ou rede social/rumor. A API do X é paga e cara, por isso ela entra como conector opcional.
- **Originalidade:** o texto é próprio e comenta a notícia, a fonte é citada e a imagem é o modelo da marca. **Não** usar a imagem da notícia, porque isso é conteúdo de terceiros e prejudica a monetização.

**Muda em relação ao desenho original:** a regra "publicar sem aprovação humana = fracasso" passa a ser "aprovação por padrão, com automático opcional e com travas".

**Dependências:** organizações com tags, contas Meta vinculadas, a grade (ADR 0007) e um gerador de imagens a partir de modelos.

## D2 — Modo "só gerar cortes" (sem publicação automática)

**Registrado em:** 2026-11-17. **Estado:** alternativa registrada para retomarmos. O dono escolheu a publicação automática desde o início.

**Ideia:** um modo por organização ou por rede em que a central gera os cortes prontos (vídeo + texto) para **baixar e postar manualmente**, sem nenhuma integração de publicação. Ele serve para redes ainda sem aprovação (ex.: se a Meta não permitir app Live sem App Review, ver risco 1 do design de 2026-11-17), para contas que o dono prefira postar à mão e como fallback durante incidentes de API.

**Observação:** a primeira entrega já tem download de vídeo e cópia de texto em todas as redes (fallback manual). O D2 formaliza isso como um modo configurável.

## D3 — Fallback de transcrição

**Registrado em:** 2026-11-18, ao fechar a Fase 3. **Estado:** adiado.

Sem fallback de transcrição nesta fase. O fallback previsto em docs/04 (`gpt-4o-mini-transcribe`) ❓ não tem timestamp por palavra; a interface aceita uma cadeia, mas só o Groq é implementado.

**Efeito hoje:** se o Groq falhar depois das tentativas, a fonte fica `failed` e o usuário usa "Tentar de novo". Os candidatos dependem do timestamp por palavra, então um fallback só serve se entregar isso (ou se aceitarmos candidatos só pelos sinais técnicos).

## Outros itens adiados no refinamento de 2026-11-17

- **Plano B do cortador:** trocar o motor híbrido por uma API de cortes de terceiros (ex.: Vizard, Klap; preço e termos a confirmar) se a qualidade não bastar.
- **Rastreamento avançado** no reenquadramento (seguir objetos e a ação em gameplay), além dos layouts simples da primeira entrega.
- **Conector do X/Twitter** para o modo orgânico (API paga).
