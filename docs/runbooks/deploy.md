# Runbook de deploy (VPS)

Deploy da Central de Conteúdo em uma VPS (Hetzner CPX32, Ubuntu LTS) com as imagens publicadas no GHCR pelo workflow `images.yml`.

> **Status:** as etapas de criar o repositório GitHub, ver o primeiro CI verde e executar este runbook na VPS **estão pendentes de confirmação do dono do produto** (geram custo ou publicam código). Nada abaixo foi executado em produção ainda.

## 1. Pré-requisitos

- VPS Ubuntu LTS com IP público e um domínio (`PANEL_DOMAIN`) cujo registro DNS `A`/`AAAA` aponta para ela.
- Bucket S3 compatível (Cloudflare R2) com chave de acesso própria.
- Repositório no GitHub com o `images.yml` já executado em `main` (imagens `central-web`, `central-worker` e `central-migrate` visíveis no GHCR).

## 2. Preparar a VPS

1. Criar um usuário não root com chave SSH e desativar login por senha e login do root no `sshd`.
2. Firewall: liberar só 22, 80 e 443.
   ```bash
   sudo ufw default deny incoming && sudo ufw default allow outgoing
   sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
   sudo ufw enable
   ```
3. Atualizações de segurança automáticas: `sudo apt install unattended-upgrades` e `sudo dpkg-reconfigure -plow unattended-upgrades`.
4. Instalar Docker Engine e o plugin Compose (repositório oficial da Docker) e adicionar o usuário ao grupo `docker`.
5. Criar `/opt/central` e copiar para lá `compose.prod.yaml`, `Caddyfile` e `.env.example` do repositório (a pasta `docker/` não é necessária: as imagens já vêm prontas).

## 3. Login no GHCR

As imagens ficam **privadas** (recomendado). Na VPS, autenticar com um Personal Access Token (classic) com o escopo `read:packages`, de preferência de uma conta de serviço:

```bash
echo "<PAT>" | docker login ghcr.io -u <usuario-github> --password-stdin
```

Alternativa: tornar os três pacotes públicos nas configurações do pacote no GitHub (dispensa o login, mas expõe o código empacotado).

## 4. Configuração (`/opt/central/.env`)

Copiar `.env.example` para `/opt/central/.env` e `chmod 600`. Os valores do exemplo são fictícios: **gerar valores novos** para produção.

| Variável | Produção |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | usuário, senha forte nova e nome do banco |
| `PANEL_DOMAIN` | domínio do painel, sem `https://` (o Caddy emite o TLS sozinho). Obrigatório |
| `APP_ORIGIN` | `https://<PANEL_DOMAIN>` |
| `NUXT_SESSION_PASSWORD` | `openssl rand -base64 48` |
| `APP_ENCRYPTION_KEYS` | `echo "1:$(openssl rand -base64 32)"` |
| `TRUST_PROXY` | `true` (atrás do Caddy) |
| `TOTP_ISSUER`, `LOG_LEVEL`, `SENTRY_DSN` | opcionais |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | dados do bucket R2 |
| `IMAGE_OWNER` | owner do GitHub **em minúsculas** (mesmo usado no `images.yml`) |
| `IMAGE_TAG` | tag a implantar: `sha-<curto>` ou a versão (`1.2.3`). Evitar `latest`/`edge` em produção |

As variáveis `MINIO_*` valem só para o compose de desenvolvimento.

**Guarda das chaves:** `APP_ENCRYPTION_KEYS` e as demais credenciais ficam em um gerenciador de senhas compartilhado entre **2 pessoas**. Perder `APP_ENCRYPTION_KEYS` torna os segredos cifrados no banco irrecuperáveis. Na rotação, acrescentar a nova versão (`2:...`) mantendo as anteriores na lista.

## 5. Deploy

Sempre a partir de `/opt/central`:

```bash
docker compose -f compose.prod.yaml --env-file .env pull
docker compose -f compose.prod.yaml --env-file .env run --rm migrate
docker compose -f compose.prod.yaml --env-file .env up -d --wait
```

**Backup antes de migrar** (mínimo): `docker compose -f compose.prod.yaml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backup-$(date +%F-%H%M).dump` (o `sh -c` roda dentro do container, onde as variáveis existem). Guardar uma cópia fora da VPS.

**Restore** (mínimo): com os serviços parados exceto o `postgres`, `docker compose -f compose.prod.yaml exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < backup-<data>.dump`.

## 6. Primeiro administrador

Roda no container do worker (o CLI está empacotado em `dist/bootstrap-admin.js`). Só funciona se ainda não houver admin; retorna erro caso contrário.

```bash
docker compose -f compose.prod.yaml --env-file .env exec worker node dist/bootstrap-admin.js \
  --email <e-mail> --name "<nome>" --brand-name "<marca>" --brand-slug <slug>
```

O CLI imprime a senha temporária. No primeiro login, trocar a senha e configurar o 2FA (TOTP).

## 7. Verificação

```bash
curl -fsS https://<PANEL_DOMAIN>/api/health
```

Esperado: HTTP 200, `"status":"ok"` (Postgres, storage e heartbeat do worker) e certificado válido. Em seguida, entrar no painel e fazer login com 2FA. `docker compose -f compose.prod.yaml ps` deve mostrar `web`, `worker` e `postgres` como `healthy`.

## 8. Rollback

As migrações desta fase são **somente aditivas**, então voltar para a imagem anterior é seguro:

1. Em `.env`, trocar `IMAGE_TAG` pela tag da versão anterior.
2. Repetir o deploy (seção 5: `pull`, `migrate`, `up -d --wait`). O `migrate` anterior não desfaz nada e é idempotente.
3. Se uma migração futura deixar de ser aditiva, restaurar o backup `pg_dump` em vez de apenas trocar a tag.
