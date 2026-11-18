# Runbook: Google OAuth e YouTube

Para o dono do produto. Cria o projeto no Google Cloud e o cliente OAuth que a Central usa para conectar o canal do YouTube de cada organização. Fontes: [youtube.md](../07-integracoes/youtube.md) (§3 e §10) e as páginas oficiais citadas lá.

> **Status:** nada abaixo foi executado ainda. Itens ❓ são hipóteses a validar por você no console do Google.

## 1. Projeto e API

1. No [Google Cloud Console](https://console.cloud.google.com), crie um projeto **dedicado** à Central. As políticas do YouTube pedem um projeto de API por cliente de API ([youtube.md](../07-integracoes/youtube.md) §1).
2. Em **APIs e serviços → Biblioteca**, ative a **YouTube Data API v3**.

## 2. Tela de consentimento

1. **APIs e serviços → Tela de permissão OAuth**: tipo de usuário **External**.
2. Preencha nome do app, e-mail de suporte e e-mail do desenvolvedor.
3. Adicione os escopos `https://www.googleapis.com/auth/youtube.upload` e `https://www.googleapis.com/auth/youtube.readonly`.
4. Uso **pessoal, com menos de 100 usuários**: a verificação do app não é necessária nesse caso, e o Google mostra a tela de "app não verificado", que você aceita ao conectar ([youtube.md](../07-integracoes/youtube.md) §3.4, fonte: [support.google.com/cloud/answer/13464323](https://support.google.com/cloud/answer/13464323)). ❓ O console mostra a classificação (sensível ou restrito) de cada escopo ao adicioná-lo; anote o que aparecer.
5. **Atenção ao status de publicação.** Em **Testing**, o refresh token de um app External **expira em 7 dias** ([youtube.md](../07-integracoes/youtube.md) §3.3 ✅), o que obrigaria a reconectar o canal toda semana. O caminho provável é publicar o app em **In production**, sem verificação, apoiado na exceção de uso pessoal. ❓ **Hipótese não validada** de que assim o refresh token não expira em 7 dias (a regra citada só fala de Testing). **Valide:** conecte um canal, espere mais de 8 dias e confira se a Central ainda consegue usar o canal (critério H6 em [16 §5](../16-riscos-e-limitacoes.md)). Se o Google passar a recusar o refresh token (`invalid_grant`), o app ainda está sujeito à expiração. Nesta fase a Central ainda não renova nem monitora o token sozinha: a conferência do refresh token depois de 8 dias é manual.

## 3. Cliente OAuth "Web"

1. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**, tipo **Aplicativo da Web**.
2. Em **URIs de redirecionamento autorizados**, adicione exatamente:

   ```
   https://<PANEL_DOMAIN>/api/oauth/youtube/callback
   ```

   É `${APP_ORIGIN}/api/oauth/youtube/callback`, então o domínio e o `https` precisam ser os mesmos do `APP_ORIGIN` do `.env`. Qualquer diferença gera `redirect_uri_mismatch`.
3. Copie o **ID do cliente** e o **Segredo do cliente**.

## 4. Configurar a Central

No `.env` da VPS ([deploy.md](deploy.md) §4):

```
GOOGLE_OAUTH_CLIENT_ID=<id do cliente>
GOOGLE_OAUTH_CLIENT_SECRET=<segredo do cliente>
```

Guarde o segredo no mesmo gerenciador de senhas da `APP_ENCRYPTION_KEYS`. As duas variáveis são necessárias: sem qualquer uma, a conexão do YouTube responde **503 "Integração não configurada"** e o resto do painel funciona. Reinicie o web: `docker compose -f compose.prod.yaml --env-file .env up -d web`.

## 5. Conectar o canal

Na Central, **Organização → Contas → Conectar YouTube**. O fluxo pede acesso offline (`access_type=offline`) e força o consentimento (`prompt=consent`), para o Google devolver o refresh token, que fica **cifrado**. Autorize com a conta Google dona do canal (ou gerente do canal de marca, [ADR 0006](../adr/0006-youtube-canal-de-marca-gmail.md)). Um canal só pode estar vinculado a **uma** organização.

Limite do Google: **100 refresh tokens por conta Google por client ID**, e um token novo invalida o mais antigo sem aviso. Por isso não reconecte à toa ([youtube.md](../07-integracoes/youtube.md) §3.1).

## 6. Cota (compartilhada por todas as organizações)

A cota é **por projeto do Google**, não por canal ou organização, então todas as organizações da Central dividem a mesma ([youtube.md](../07-integracoes/youtube.md) §10):

- padrão ✅: **10.000 unidades por dia** para os endpoints em geral, mais buckets separados de **100 chamadas `videos.insert` por dia** e 100 de `search.list` (regra vigente desde 01/06/2026 segundo [youtube.md](../07-integracoes/youtube.md));
- reset à meia-noite do horário do Pacífico;
- existe ainda um limite diário de uploads **por canal**, independente da cota, e o número não é publicado (❓).

**Aumento de cota:** exige auditoria de compliance, pelo [YouTube API Services Audit and Quota Extension Form](https://support.google.com/youtube/contact/yt_api_form), sem prazo publicado (🔒, [youtube.md](../07-integracoes/youtube.md) §4 e §10.4). Pela spec §5.5, o pedido só é necessário se o volume somado das organizações se aproximar de 100 uploads/dia. O painel avisa quando o uso passar de 80% do limite diário.

## 7. Problemas comuns

- **`redirect_uri_mismatch`:** o URI do passo 3 não bate com `APP_ORIGIN`.
- **503 "Integração não configurada":** falta uma das duas variáveis `GOOGLE_OAUTH_*`, ou o web não foi reiniciado.
- **Canal que deixou de funcionar (`invalid_grant`), ou marcado "reconectar":** o Google invalidou o refresh token (`invalid_grant`, [youtube.md](../07-integracoes/youtube.md) §3.1): revogado pelo usuário, expirado (app em Testing) ou substituído. Reconecte pela tela de contas.
