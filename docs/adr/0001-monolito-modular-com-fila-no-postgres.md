# ADR 0001 — Monolito modular TypeScript com fila no PostgreSQL

- **Status:** aceito (2026-11-15)
- **Contexto:** central interna para 1 página gamer (1–3 vídeos/dia), preparada para várias páginas do mesmo dono; requisitos fortes de idempotência, retry, concorrência e testes; operação por poucas pessoas.
- **Decisão:** Nuxt 4 (painel + API) e um processo worker no mesmo monorepo; PostgreSQL como banco e fila (pg-boss); storage S3-compatível (R2); FFmpeg; Docker Compose em uma VPS.
- **Alternativas:** (B) mesma arquitetura com Redis/BullMQ — adiada até os gatilhos de [03 §8](../03-arquitetura.md); (C) n8n como orquestrador — rejeitada para o núcleo; (D) serverless — rejeitada por limites com FFmpeg.
- **Consequências:** poucas peças e baixo custo; escala vertical no início; interface `JobQueue` isola uma futura troca de fila.
