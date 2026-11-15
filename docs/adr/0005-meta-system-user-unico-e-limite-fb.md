# ADR 0005 — Meta: System User único para IG e FB; vídeos > 90 s fora do Facebook

- **Status:** aceito (2026-11-15)
- **Contexto:** o Instagram profissional e a Página do Facebook já estão no mesmo Business Manager, com o IG vinculado à Página. A Meta oferece três variantes da API do Instagram (Instagram Login, Facebook Login, Unified Login). Reels de Página via API aceitam apenas vídeos de 3–90 s, enquanto os vídeos da marca vão de 30 s a 3 min.
- **Decisão:** (1) um app Meta Business + **um System User** cujo token atende o Facebook (`video_reels`) e o Instagram (Instagram API with Facebook Login, IG vinculado), com upload resumable nas duas; (2) vídeos acima de 90 s **não** são publicados no Facebook — o sistema bloqueia a seleção com explicação (vídeo de Página fica para a Fase 10).
- **Alternativas:** Unified Login para o IG (recomendada pela Meta para novas integrações, mas exigiria um segundo fluxo de token e tem lacunas na doc); publicar vídeos longos como vídeo de Página (novo formato no MVP); modo manual para FB > 90 s.
- **Consequências:** um único cofre de token e fluxo de conexão para as duas redes; menos alcance no Facebook para vídeos longos; reavaliar Unified Login se recursos necessários forem exclusivos dela.
