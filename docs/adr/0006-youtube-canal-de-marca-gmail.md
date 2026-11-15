# ADR 0006 — YouTube: canal de marca com Gmail dedicado

- **Status:** aceito (2026-11-15)
- **Contexto:** a marca ainda não tem canal no YouTube. A conta Google dona do canal define o tipo de app OAuth: Workspace permite app *Internal* (sem verificação, sem expiração de 7 dias do refresh token); Gmail exige app *External / In production*. O objetivo futuro é monetizar (Programa de Parcerias do YouTube), que não depende do tipo de conta Google.
- **Decisão:** criar um **canal de marca (Brand Account)** cujo dono é um **Gmail dedicado** à operação, com verificação em duas etapas e acesso em gerenciador de senhas compartilhado (≥ 2 pessoas); verificar o canal por telefone; equipe como gerentes; app OAuth *External / In production*.
- **Alternativas:** canal pessoal ligado a um Gmail (nome e propriedade presos à pessoa; descartado); Google Workspace desde já (mensalidade e exige domínio; adiado).
- **Consequências:** custo zero; depende da hipótese H6 (refresh token não expira em produção sem verificação), validada com teste de 8 dias antes da Fase 6. **Plano B:** transferir a propriedade do canal de marca para uma conta Workspace e usar app *Internal*, sem perder vídeos nem inscritos. Monetização: requer AdSense (CPF ou CNPJ) e cumprimento das políticas, em especial a de conteúdo reutilizado ([18](../18-originalidade-e-politicas.md)).
