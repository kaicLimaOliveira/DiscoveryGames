# Runbook: app Meta (Instagram e Facebook)

Para o dono do produto. Cria o app Meta, o System User e o token que a Central usa para publicar no Instagram e na Página do Facebook de **cada organização**.

> **Status:** nada abaixo foi executado ainda. A validação do passo 6 (app Live só com Standard Access) é o **risco nº 1** do projeto ([spec §10](../superpowers/specs/2026-11-17-organizacoes-e-cortador-design.md)) e **só você pode fazê-la**, no painel da Meta. Até o resultado existir, tratamos "Live com Standard Access, sem App Review" como **hipótese** (❓ em [facebook.md](../07-integracoes/facebook.md) §4 e [instagram.md](../07-integracoes/instagram.md) §4).

A Meta muda os nomes de menus com frequência (o painel atual cria apps por "casos de uso"; o nome exato do caso de uso de Páginas também é ❓ em [facebook.md](../07-integracoes/facebook.md) §2). Se um nome abaixo não existir, procure o equivalente e anote no resultado do passo 6.

## 0. Antes de começar

- Você precisa ser administrador do **Business Manager (portfólio de negócios) que contém as Páginas** e os Instagram profissionais das organizações. Em cada organização, o IG e a Página já devem estar vinculados entre si.
- O Instagram precisa ser conta **Business** (ou Creator, ❓ pode haver diferenças de recursos).
- Na Central, o domínio do painel e o deploy já devem estar no ar ([deploy.md](deploy.md)).

## 1. Criar o app Meta do tipo Business

1. Em [developers.facebook.com](https://developers.facebook.com), **Meus apps → Criar app**.
2. Tipo **Business**, e associe o app ao Business Manager que contém as Páginas.
3. Anote o **ID do app** e o **Segredo do app** (Configurações → Básico). Eles viram `META_APP_ID` e `META_APP_SECRET` no `.env` da VPS (passo 7).

## 2. Adicionar os casos de uso

Adicione os casos de uso (produtos) de **Instagram** (API do Instagram com Facebook Login, com o IG vinculado à Página) e de **Páginas** (gerenciar a Página e publicar vídeos/Reels). A Central usa o caminho "Instagram API with Facebook Login", conforme a [ADR 0005](../adr/0005-meta-system-user-unico-e-limite-fb.md).

## 3. Criar o System User

1. Em **Configurações do negócio → Usuários → Usuários do sistema**, crie um usuário do sistema **regular** (não admin). A Meta recomenda o regular e um por necessidade de acesso ([facebook.md](../07-integracoes/facebook.md) §3.2).
2. Em **Adicionar ativos**, atribua a ele:
   - a **Página** do Facebook, com as tarefas de **conteúdo** (criar conteúdo) e de análise;
   - a **conta do Instagram**, com controle de conteúdo.
3. Atribua também o **app** criado no passo 1 ao negócio/usuário do sistema, para poder gerar token para ele.

❓ Os nomes exatos das tarefas (`CREATE_CONTENT` e `ANALYZE` aparecem em [facebook.md](../07-integracoes/facebook.md) §3.2) e se um app que só usa Páginas atende ao pré-requisito de "Standard access" ao Marketing API para gerar o token **não estão confirmados**. Se o painel pedir algo a mais, registre no resultado do passo 6.

## 4. Gerar o token

Em **Usuários do sistema → Gerar token**, escolha o app e marque estes escopos:

- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`
- `instagram_basic`
- `instagram_content_publish`

O token pode ser **não expirante** ou de **60 dias**. A Meta recomenda o de 60 dias, com renovação ([facebook.md](../07-integracoes/facebook.md) §3.2); a Central **ainda não renova tokens sozinha** nesta fase, então anote a data de validade se escolher o de 60 dias.

**Plano B:** se não der para usar System User, cole na mesma tela um **token de usuário long-lived** de um administrador da Página, obtido com `fb_exchange_token` ([facebook.md](../07-integracoes/facebook.md) §3.1, passo 2). A Central chama `/me/accounts` com ele, deriva o token de cada Página e guarda só o **token da Página**, cifrado. **Não cole um Page token**: `/me/accounts` falha com ele. **Atenção:** um token de usuário de curta duração, como o do Graph API Explorer, gera tokens de Página que expiram em cerca de 1 hora; troque-o por um long-lived antes. O vínculo fica preso à pessoa que gerou o token.

### Onde guardar o token

No **mesmo gerenciador de senhas** (compartilhado entre 2 pessoas) onde estão as `APP_ENCRYPTION_KEYS` ([deploy.md](deploy.md) §4). Ele é **colado uma única vez** na tela de conexão da Central, que o usa para listar as Páginas, e guarda **só o token da Página, cifrado**. O token do System User em si não fica no banco.

## 5. Vários Business Managers

Se as organizações estiverem em **Business Managers diferentes**, **repita os passos 3 e 4 em cada Business Manager**: cada um tem o seu System User e o seu token. O app Meta pode ser o mesmo, desde que consiga gerar token em cada negócio; ❓ isso depende de como a Meta trata um app de um negócio acessando ativos de outro (pode exigir passos extras, ou um app por Business Manager). Registre o que acontecer. A Central tem **uma conexão Meta por organização**, então cada organização recebe o token do Business Manager que contém a sua Página.

## 6. Validar: o app pode ir para Live só com Standard Access? (risco nº 1)

**Por que importa:** com o app em modo **Development**, os posts de teste só ficam visíveis para quem tem papel no app ([facebook.md](../07-integracoes/facebook.md) §4, [instagram.md](../07-integracoes/instagram.md) §4). Um Reel publicado nesse modo **pode não ficar público**. A documentação diz que um app só para um negócio próprio roda em Standard Access sem App Review, mas ❓ **não confirma** que o painel deixa o app ir para **Live** sem App Review.

**O teste (você faz):**

1. No painel do app, tente colocar o app em **Live** usando só **Standard Access**, sem enviar App Review nem Business Verification. Anote exatamente o que o painel exige ou bloqueia (captura de tela).
2. Se foi para Live: na Central, conecte uma organização de teste (passo 8) e publique **um Reel de teste** no Instagram e outro na Página (a publicação automática chega só na Fase 5; até lá, use o Graph API Explorer ou cURL com o mesmo token).
3. Abra o post **de uma conta sem papel no app** (navegador anônimo) e confira se ele está **público**.
4. Se não foi possível ir para Live, ou o post só aparece para quem tem papel: o IG e o FB caem para o modo manual assistido ([spec §10](../superpowers/specs/2026-11-17-organizacoes-e-cortador-design.md), D2 em [21](../21-debitos-tecnicos.md)) e o pedido de App Review começa na hora.

**Registre o resultado** (data, o que o painel exigiu, se o post ficou público) na seção "Resultado da validação Meta Live" da [ADR 0009](../adr/0009-organizacoes-e-contas.md). Enquanto estiver em branco, nada na Central deve dar a publicação automática na Meta como garantida.

## 7. Configurar a Central

No `.env` da VPS ([deploy.md](deploy.md) §4):

```
META_APP_ID=<id do app>
META_APP_SECRET=<segredo do app>
META_GRAPH_VERSION=v<NN.N>
```

`META_GRAPH_VERSION` **não tem valor padrão**: informe a versão da Graph API com a qual você validou o app (formato `vNN.N`; os exemplos oficiais lidos em 2026-11-15 usam a v27.0, [instagram.md](../07-integracoes/instagram.md)). As três variáveis são necessárias; sem qualquer uma delas a tela de conexão responde **503 "Integração não configurada"** e o resto do painel funciona normalmente. Depois de editar o `.env`, reinicie o serviço web: `docker compose -f compose.prod.yaml --env-file .env up -d web`.

## 8. Conectar a organização

Na Central, **Organização → Contas → Conectar Meta**: cole o token (passo 4), a Central lista as Páginas que o token enxerga, escolha a Página da organização. Ela vincula a **Página do Facebook** e o **Instagram** ligado a ela. Uma conta Meta só pode estar vinculada a **uma** organização.

## 9. Problemas comuns

- **"Integração não configurada" (503):** falta alguma das três variáveis `META_*`, ou o web não foi reiniciado.
- **Token recusado / Página não aparece:** confira os cinco escopos, se a Página foi atribuída ao System User e se o app foi atribuído ao usuário.
- **Página sem Instagram:** a Central pede confirmação para vincular só o Facebook.
- **Token vencido (se escolheu 60 dias):** gere outro no Business Manager e cole de novo na tela.
