# ADR 0003 — Agendamento próprio com o banco como fonte da verdade

- **Status:** aceito (2026-11-15)
- **Contexto:** Instagram e TikTok não têm agendamento nativo via API; Facebook e YouTube têm, com regras diferentes. É preciso pausar, cancelar, editar e checar aprovação de forma uniforme.
- **Decisão:** agendamento próprio (`Publication.scheduledAt` em UTC + job com `startAfter` + *scheduler tick* por minuto como rede de segurança). Agendamento nativo fica como opção futura por adaptador.
- **Consequências:** comportamento uniforme; depende da VPS estar no ar no horário (mitigado por `MISSED_WINDOW` e alertas). Ver [11](../11-agendamento.md).
