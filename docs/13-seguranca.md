# 13 — Segurança

## 1. Ativos e ameaças

| Ativo | Ameaça principal | Impacto |
|---|---|---|
| Tokens OAuth das redes | Vazamento (banco, logs, backup) | Terceiros publicando em nome da marca |
| Chaves de API (Claude, transcrição, Meta app secret, Google client secret, TikTok client secret) | Vazamento | Custos indevidos, abuso dos apps |
| Contas do painel | Senha fraca, roubo de sessão | Publicação indevida, desconexão de contas |
| Vídeos originais | Acesso público indevido ao bucket | Vazamento de conteúdo antes da publicação |
| Fluxo de publicação | Publicação sem aprovação | Dano reputacional |
| Callbacks OAuth | CSRF / troca de conta | Vincular conta de terceiros |
| Upload de arquivos | Arquivos maliciosos explorando decoders | Execução remota no worker |

## 2. Credenciais e segredos

| Tipo | Onde fica | Proteção |
|---|---|---|
| Segredos da aplicação (client secrets, API keys, chave mestra) | Variáveis de ambiente na VPS (arquivo `.env` com `chmod 600`, dono root) ou SOPS/age no repositório | Nunca no Git em texto claro; rotação documentada |
| Tokens OAuth por conta | `OAuthCredential` no Postgres | **Cifragem de envelope AES-256-GCM** com chave mestra (`APP_ENCRYPTION_KEYS`, lista `versão:chave-base64` de 32 bytes; a maior versão cifra, todas decifram) fora do banco; IV aleatório por valor; `keyVersion` para rotação |
| Senhas de usuários | `User.passwordHash` | Argon2id (parâmetros OWASP atuais) |
| TOTP | `User.totpSecretEnc` | Cifrado como os tokens |

Regras:

- Tokens **nunca** saem do backend: a API do painel retorna só status, escopos e validade.
- Decifrar apenas no momento do uso, no worker/rota que vai chamar a plataforma; não manter em cache.
- Rotação da chave mestra: nova versão → job re-cifra todas as credenciais → remove a antiga.
- Backups do Postgres são cifrados (age/gpg) antes de ir para o R2; a chave mestra **não** vai junto com o backup.
- Para o Meta, preferir token de **System User** do Business Manager com escopos mínimos (ver [08](08-autenticacao-autorizacao.md)).
- Renovação proativa de tokens **sempre com trava por conta** (na Content Posting API do TikTok o refresh token é rotativo — duas renovações concorrentes invalidariam a credencial; na Accounts API a rotação não está documentada, então a trava é aplicada por precaução em todas as plataformas).

## 3. Painel: autenticação e autorização

| Controle | Implementação |
|---|---|
| Login | E-mail + senha (Argon2id); sem cadastro público — admin convida usuários |
| 2FA | TOTP obrigatório para `admin` e `approver` |
| Sessão | Cookie selado (`HttpOnly`, `Secure`, `SameSite=Lax`), expiração 12 h deslizante, revogação ao trocar senha |
| Força bruta | Rate limit por IP e por e-mail no login (ex.: 5 tentativas / 15 min) |
| Autorização | Verificação de papel **no servidor** em toda rota (`requireRole('approver')`) + filtro por `organizationId` via `OrganizationMember` |
| CSRF | `SameSite=Lax` + verificação de `Origin` em métodos mutáveis |
| Auditoria | `AuditLog` para login, aprovar, publicar, cancelar, conectar/desconectar conta, alterar configurações, ver logs de erro |

Matriz de permissões:

| Ação | viewer | editor | approver | admin |
|---|---|---|---|---|
| Ver biblioteca, calendário, métricas | ✔ | ✔ | ✔ | ✔ |
| Upload, editar contexto e textos | | ✔ | ✔ | ✔ |
| Aprovar/rejeitar, publicar, agendar, cancelar | | | ✔ | ✔ |
| Conectar/desconectar contas, configurações, usuários, orçamento | | | | ✔ |
| Pausa global de publicações | | | ✔ | ✔ |

> **Limitações conhecidas (Fase 1):** ativar o 2FA a partir de uma sessão completa não revoga as outras sessões do usuário, e o logout apenas limpa o cookie no cliente (a sessão selada continua válida até expirar ou até a `sessionVersion` mudar, por troca de senha ou de vínculos). Comportamento mantido por ora.

## 4. OAuth com as plataformas

- `state` aleatório (≥ 128 bits) armazenado em cookie selado de curta duração e validado no callback.
- **PKCE** (`S256`) quando a plataforma suporta.
- `redirect_uri` fixos e registrados; nenhum parâmetro de redirecionamento aberto.
- Solicitar **somente** os escopos necessários; registrar `grantedScopes` e alertar se faltar algum.
- Após o callback, confirmar que a conta/página/canal escolhido pertence ao conjunto permitido da organização.

## 5. Arquivos e mídia

| Controle | Detalhe |
|---|---|
| Upload direto ao R2 | URL pré-assinada com expiração curta (15 min), `Content-Type` e tamanho máximo fixados na assinatura |
| Bucket privado | Originais e renditions em bucket **privado**; leitura via URL pré-assinada curta |
| Entrega às plataformas | Upload de bytes em todas as integrações automáticas (IG resumable, FB `rupload`, YouTube resumable); nenhum arquivo público. TikTok manual: download pelo painel com URL pré-assinada curta. (Se a API for Business do TikTok for adotada no futuro: bucket de entrega separado em domínio verificado, caminho aleatório ≥ 128 bits, objeto apagado após o status final) |
| Validação | Tipo real via ffprobe (não pela extensão), limites de tamanho/duração, rejeitar arquivos com streams inesperados |
| Isolamento | FFmpeg em container do worker sem privilégios, sem acesso à rede além do necessário, com limites de CPU/memória; binário atualizado (CVE de decoders) |

## 6. Rede e infraestrutura

- Somente portas 80/443 (Caddy) e SSH (chave, sem senha, idealmente restrito por IP ou via Tailscale) expostas; Postgres apenas na rede interna do Docker.
- Firewall do provedor + `ufw`; atualizações automáticas de segurança do SO.
- Containers com usuário não root, sistema de arquivos somente leitura quando possível.
- Cabeçalhos: HSTS, CSP restritiva, `X-Content-Type-Options`, `Referrer-Policy`.
- Webhooks recebidos (TikTok, Meta, se usados): validar assinatura e deduplicar por ID de evento.

## 7. Logs e privacidade

- Redação automática no logger (pino `redact`) para: `authorization`, `access_token`, `refresh_token`, `client_secret`, `code`, `password`, `cookie`, URLs pré-assinadas (assinatura).
- `PublishAttempt.requestSummary`/`responseSummary` guardam só campos permitidos (allowlist), nunca o corpo inteiro.
- LGPD: dados pessoais apenas dos usuários internos (nome, e-mail, IP em auditoria). Métricas são agregadas da própria conta. Política de retenção em [05 §4](05-modelo-de-dados.md).

## 8. Segurança da IA

- Entradas do usuário e transcrições são **dados**, não instruções: prompts delimitam claramente os blocos de conteúdo; o modelo não tem ferramentas com efeito colateral (só web search, somente leitura).
- Resultados de web search são tratados como não confiáveis; nunca executados; exibidos com a fonte.
- O LLM nunca publica nada: publicação só ocorre após aprovação humana, por código determinístico.

## 9. Resposta a incidentes (mínimo)

| Situação | Ação |
|---|---|
| Suspeita de vazamento de token | Desconectar a conta no painel (apaga credencial), revogar acesso na plataforma, reconectar; rotacionar chave mestra |
| Publicação indevida | Botão de pausa global; remover post manualmente na plataforma; investigar via `AuditLog` e `PublishAttempt` |
| Chave de API vazada | Rotacionar no provedor; atualizar `.env`; reiniciar serviços |
| Perda da VPS | Nova VPS + `docker compose` + restore do backup + chave mestra do cofre offline |

A chave mestra e o acesso ao Business Manager/Google Cloud/TikTok Developer devem estar guardados em um gerenciador de senhas da equipe com pelo menos duas pessoas com acesso.
