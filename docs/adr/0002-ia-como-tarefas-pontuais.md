# ADR 0002 — IA como tarefas pontuais com saída estruturada, não agentes autônomos

- **Status:** aceito (2026-11-15)
- **Contexto:** o briefing sugeria seis agentes; os passos têm entradas e saídas bem definidas; custo de tokens e previsibilidade importam; publicação exige determinismo.
- **Decisão:** tarefas `analyze`, `fact_check` (com web search do servidor), `generate_copy`, `regenerate_copy`, `watermark_scan`, `weekly-insights`, cada uma com prompt versionado e JSON Schema. Processamento de vídeo e publicação são serviços determinísticos sem LLM. Claude como provedor atrás de `LlmProvider`.
- **Consequências:** menor custo e latência; testável com fakes; agentes podem ser introduzidos depois para tarefas abertas sem mudar o resto. Ver [09](../09-estrategia-ia.md).
