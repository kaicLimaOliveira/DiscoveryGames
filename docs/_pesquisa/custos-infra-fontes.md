# Custos de infraestrutura: preços e fontes

**Data da coleta:** 2026-11-15 (todas as URLs foram acessadas nessa data, salvo indicação).
**Escopo:** central de automação de conteúdo (Nuxt 4 + worker Node + PostgreSQL/pg-boss + S3 + FFmpeg em Docker Compose numa VPS).
**Volume de referência:** 1 a 3 vídeos verticais/dia (30 s a 3 min, 50 a 300 MB cada), até 4 versões por vídeo.
**Fora do escopo:** preços da API Anthropic/Claude (você já tem).

Legenda: ✅ confirmado na fonte oficial nesta data · ❓ não confirmado (fonte de terceiros, página sem o dado ou hipótese)

Preços sem impostos (IVA/ISS/IOF não incluídos). Câmbio não aplicado.

---

## 0. Premissas de volume usadas nas estimativas

| Premissa | Valor | Observação |
|---|---|---|
| Vídeos/mês | 30 a 90 | 1 a 3 por dia |
| Original | 50 a 300 MB | dado do briefing |
| Versões | até 4 por vídeo, ~20 a 80 MB cada | hipótese (H.264 1080x1920, 30 s a 3 min) |
| Armazenamento novo/mês | ~5 a 30 GB | originais + versões, pior caso ~90 x (300 + 4 x 60) MB ≈ 49 GB sem limpeza |
| Armazenamento em regime | ~20 a 60 GB | hipótese: apagar originais após 30 a 60 dias |
| Minutos de áudio/mês | 15 a 270 min | transcrição só do original |
| Downloads pelas redes | ~120 a 360 por mês, ~10 a 25 GB | as plataformas buscam cada versão por URL |

---

## 1. VPS

### 1.1 Hetzner Cloud (EUR, sem IVA)

Em 2026 a Hetzner renomeou as linhas para "Cost-Optimized" (CX/CAX), "Regular Performance" (CPX x2) e "General Purpose" (CCX, vCPU dedicada). Na data da coleta as páginas marcavam vários planos como **"currently unavailable"** (sem estoque para criar). Os antigos CPX31/CPX41 agora aparecem **só nas regiões dos EUA**, com preço bem mais alto.

| Item | Preço | Unidade | Fonte (URL) | Status |
|---|---|---|---|---|
| CX33: 4 vCPU (Intel/AMD, compartilhada), 8 GB, 80 GB NVMe, 20 TB (NBG1/HEL1) | €8,99 | /mês | https://www.hetzner.com/cloud/cost-optimized/ | ✅ (indisponível p/ criação na data) |
| CX43: 8 vCPU, 16 GB, 160 GB, 20 TB | €16,49 | /mês | https://www.hetzner.com/cloud/cost-optimized/ | ✅ (indisponível) |
| CAX21: 4 vCPU ARM Ampere, 8 GB, 80 GB | €10,99 | /mês | https://www.hetzner.com/cloud/cost-optimized/ | ✅ (indisponível) |
| CPX22: 2 vCPU AMD, 4 GB, 80 GB, 20 TB | €19,99 (NBG1) / €16,99 (HEL1) | /mês | https://www.hetzner.com/cloud/regular-performance/ | ✅ |
| **CPX32: 4 vCPU AMD, 8 GB, 160 GB, 20 TB** | **€35,99 (NBG1) / €30,49 (HEL1)** | /mês | https://www.hetzner.com/cloud/regular-performance/ | ✅ |
| CPX42: 8 vCPU AMD, 16 GB, 320 GB, 20 TB | €69,99 (NBG1) / €59,49 (HEL1) | /mês | https://www.hetzner.com/cloud/regular-performance/ | ✅ |
| CPX31 (legado, só EUA HIL1/ASH1): 4 vCPU, 8 GB, 160 GB, 3 TB | €62,99 | /mês | https://www.hetzner.com/cloud/regular-performance/ | ✅ |
| CPX41 (legado, só EUA): 8 vCPU, 16 GB, 240 GB, 4 TB | €120,99 | /mês | https://www.hetzner.com/cloud/regular-performance/ | ✅ |
| CCX13: 2 vCPU dedicada, 8 GB, 80 GB | €36,99 (HEL1) / €43,49 (NBG1) / €43,99 (EUA) | /mês | https://www.hetzner.com/cloud/general-purpose/ | ✅ |
| CCX23: 4 vCPU dedicada, 16 GB, 160 GB | €73,49 (HEL1) / €86,49 (NBG1) | /mês | https://www.hetzner.com/cloud/general-purpose/ | ✅ |
| Regiões | Alemanha (FSN1, NBG1), Finlândia (HEL1), EUA (HIL1, ASH1), Singapura (SIN1). **Sem Brasil** | n/a | https://www.hetzner.com/cloud/ | ✅ |
| Preço em USD | não exibido nas páginas (há seletor de moeda) | n/a | n/a | ❓ |

### 1.2 DigitalOcean Droplets (USD)

| Item | Preço | Unidade | Fonte (URL) | Status |
|---|---|---|---|---|
| Basic 2 vCPU / 4 GiB / 80 GiB / 4 TB | $24 | /mês | https://www.digitalocean.com/pricing/droplets | ✅ |
| Basic 4 vCPU / 8 GiB / 160 GiB / 5 TB | $48 | /mês | https://www.digitalocean.com/pricing/droplets | ✅ |
| CPU-Optimized 2 vCPU / 4 GiB / 25 GiB | $42 | /mês | https://www.digitalocean.com/pricing/droplets | ✅ |
| CPU-Optimized 4 vCPU / 8 GiB / 50 GiB | $84 | /mês | https://www.digitalocean.com/pricing/droplets | ✅ |
| Região Brasil | DigitalOcean não tem datacenter no Brasil | n/a | (lista de regiões não verificada nesta coleta) | ❓ |

### 1.3 Opções com datacenter no Brasil

| Item | Preço | Unidade | Fonte (URL) | Status |
|---|---|---|---|---|
| Hostinger KVM 2: 2 vCPU, 8 GB, 100 GB NVMe, 8 TB | R$ 42,99 promo (24 meses) / renovação R$ 77,99 | /mês | https://www.hostinger.com/br/servidor-vps | ✅ |
| Hostinger KVM 4: 4 vCPU, 16 GB, 200 GB NVMe, 16 TB | R$ 59,99 promo (24 meses) / renovação R$ 149,99 | /mês | https://www.hostinger.com/br/servidor-vps | ✅ |
| Hostinger KVM 8: 8 vCPU, 32 GB, 400 GB NVMe | R$ 119,99 promo / renovação R$ 259,99 | /mês | https://www.hostinger.com/br/servidor-vps | ✅ |
| Hostinger: localização no Brasil | FAQ diz "servidor no Brasil" sem citar a cidade | n/a | https://www.hostinger.com/br/servidor-vps | ❓ (cidade) |
| AWS Lightsail 2 vCPU / 8 GB / 160 GB (IPv4 público) | $44 | /mês | https://aws.amazon.com/lightsail/pricing/ | ✅ |
| AWS Lightsail 4 vCPU / 16 GB / 320 GB | $84 | /mês | https://aws.amazon.com/lightsail/pricing/ | ✅ |
| Lightsail São Paulo | mesmo preço; a página indica franquia de transferência **pela metade** em algumas regiões, São Paulo incluída | n/a | https://aws.amazon.com/lightsail/pricing/ | ❓ (confirmar no console) |
| Contabo Cloud VPS 4 (4 vCPU, 8 GB), referência | €4,40 (contrato de 24 meses) | /mês | https://contabo.com/en/vps/ | ✅ |
| Contabo São Paulo | **não aparece** entre as regiões da página (EU, UK, US, SG, JP, IN, AU) | n/a | https://contabo.com/en/vps/ | ❓ (parece descontinuado ou não listado) |
| Magalu Cloud VMs | calculadora não carregou; preço não obtido. Datacenters em SP e CE | n/a | https://magalu.cloud/precos/ | ❓ hipótese: R$ 150 a 400/mês para 4 vCPU/8 GB |

### 1.4 Recomendação de perfil para FFmpeg (H.264 1080p)

- **Carga:** 1 a 3 vídeos/dia x até 4 versões de até 3 min ≈ no máximo 36 min de vídeo codificado por dia. Com libx264 `-preset medium/fast` em 1080x1920, 4 vCPUs compartilhadas costumam codificar entre 0,5x e 2x tempo real (**hipótese**, não medida). Ou seja, ~5 a 25 min de CPU por vídeo, e a fila (pg-boss) absorve isso sem problema.
- **Perfil recomendado:** **4 vCPU / 8 GB RAM / 80 a 160 GB NVMe** (Nuxt + worker + Postgres + FFmpeg + whisper local opcional). 2 vCPU/4 GB funciona, mas fica apertado se a transcrição for local. vCPU dedicada (CCX) não é necessária nesse volume.
- **Concorrência:** limitar o worker de FFmpeg a 1 job por vez (`-threads 3`) para não prejudicar o Nuxt e o Postgres.

---

## 2. Storage S3-compatível

| Item | Preço | Unidade | Fonte (URL) | Status |
|---|---|---|---|---|
| **Cloudflare R2 Standard: armazenamento** | $0,015 | GB-mês | https://developers.cloudflare.com/r2/pricing/ | ✅ |
| R2 Classe A (PUT, LIST, multipart) | $4,50 | milhão de operações | https://developers.cloudflare.com/r2/pricing/ | ✅ |
| R2 Classe B (GET, HEAD) | $0,36 | milhão de operações | https://developers.cloudflare.com/r2/pricing/ | ✅ |
| R2 egress | grátis | n/a | https://developers.cloudflare.com/r2/pricing/ | ✅ |
| R2 free tier | 10 GB-mês + 1 M Classe A + 10 M Classe B por mês | /mês | https://developers.cloudflare.com/r2/pricing/ | ✅ |
| R2 Infrequent Access | $0,01/GB-mês + $0,01/GB de recuperação, mínimo de 30 dias | n/a | https://developers.cloudflare.com/r2/pricing/ | ✅ |
| Backblaze B2: armazenamento | $6,95/TB (~$0,007/GB), 10 GB grátis | TB-mês | https://www.backblaze.com/cloud-storage/pricing | ✅ |
| B2 egress | grátis até 3x o armazenamento médio; depois $0,01/GB | GB | https://www.backblaze.com/cloud-storage/pricing | ✅ |
| B2 transações | Classes A, B e C grátis; Classe D $0,004/10 mil (2.500/dia grátis) | n/a | https://www.backblaze.com/cloud-storage/pricing | ✅ |
| AWS S3 Standard us-east-1 | $0,023 (primeiros 50 TB) | GB-mês | Price List API: https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/us-east-1/index.json | ✅ |
| S3 us-east-1 PUT / GET | $0,005 / $0,0004 | 1.000 requisições | mesma fonte acima | ✅ |
| S3 us-east-1 egress internet | $0,09 (até 10 TB); 100 GB/mês grátis somando todas as regiões | GB | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/us-east-1/index.json | ✅ |
| AWS S3 Standard sa-east-1 (São Paulo) | $0,0405 (primeiros 50 TB) | GB-mês | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/sa-east-1/index.json | ✅ |
| S3 sa-east-1 PUT / GET | $0,007 / $0,00056 | 1.000 requisições | mesma fonte acima | ✅ |
| S3 sa-east-1 egress internet | $0,15 (até 10 TB) | GB | https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/sa-east-1/index.json | ✅ |

**Custo estimado para o volume (20 a 60 GB em regime, ~1 a 3 mil operações/mês):**
- R2: (60 − 10 grátis) x $0,015 ≈ **$0,15 a $0,75/mês**. Operações e egress ficam em $0.
- B2: ≈ **$0,07 a $0,35/mês**.
- S3 us-east-1: ≈ $0,50 a $1,40 + egress (fica dentro dos 100 GB grátis) ≈ **$1 a $2/mês**. sa-east-1 sai ~75% mais caro.

### 2.1 Busca de vídeo por URL pelas redes: URL pré-assinada do R2 serve?

| Plataforma | O que a doc diz | Fonte (URL) | Status |
|---|---|---|---|
| Instagram (Reels via Graph API) | `video_url` precisa estar em **servidor público**; a Meta faz cURL do arquivo a cada tentativa de publicação. Alternativa oficial: **upload resumable** (`rupload.facebook.com`), com envio de bytes locais ou header `file_url` (exige Facebook Login for Business). Limite de 100 posts via API em 24 h. | https://developers.facebook.com/docs/instagram-platform/content-publishing/ | ✅ |
| Instagram com URL pré-assinada (query string com assinatura) | a doc não proíbe nem cita. Relatos indicam que funciona se a URL não redirecionar e continuar válida durante o processamento | https://developers.facebook.com/docs/instagram-platform/content-publishing/ | ❓ **hipótese: funciona.** Usar validade ≥ 1 h e manter até status `FINISHED`. Se falhar, usar rupload com upload dos bytes |
| TikTok PULL_FROM_URL | **exige verificação de domínio ou prefixo de URL** (DNS TXT no portal TikTok for Developers). Sem isso a API retorna 403 `url_ownership_unverified`. Exige HTTPS e **não aceita redirect**. A URL precisa ficar acessível por até 1 h. | https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide | ✅ |
| TikTok com R2 | **não dá para usar o domínio `*.r2.cloudflarestorage.com`** (não é seu). É preciso ligar um **custom domain** do R2 (ex.: `media.seudominio.com`) e verificá-lo. Alternativa: `FILE_UPLOAD` em chunks de 5 a 64 MB, sem verificação de domínio | mesma fonte acima | ✅ requisito / ❓ funcionamento de pré-assinada em custom domain não testado (presigned do R2 funciona via endpoint S3; custom domain normalmente serve objeto público). **Hipótese:** usar FILE_UPLOAD |
| YouTube | não puxa por URL: upload direto (resumable) via `videos.insert` | https://developers.google.com/youtube/v3/docs/videos/insert | ✅ |

---

## 3. PostgreSQL

| Item | Preço | Unidade | Fonte (URL) | Status |
|---|---|---|---|---|
| Self-hosted (container na VPS) | $0 extra (consome RAM/disco da VPS) + backup `pg_dump` no R2 (centavos) | /mês | n/a | ✅ (cálculo) |
| Neon Free | $0: 100 CU-h por projeto, 1 GB por projeto (20 GB no total da conta), 5 GB de egress | /mês | https://neon.com/pricing | ✅ |
| Neon Launch | sem mínimo: $0,106/CU-h + $0,35/GB-mês | uso | https://neon.com/pricing | ✅ |
| Supabase Free | $0: 500 MB de DB, **pausa após 1 semana inativo** | /mês | https://supabase.com/pricing | ✅ |
| Supabase Pro | a partir de $25 (inclui $10 de crédito de compute = 1 Micro, 8 GB de disco) | /mês | https://supabase.com/pricing | ✅ |
| DigitalOcean Managed PostgreSQL (1 vCPU / 1 GiB / 10 GiB) | $15,15 | /mês | https://www.digitalocean.com/pricing/managed-databases | ✅ |

**Atenção ao pg-boss:** ele faz polling constante, o que mantém o compute do Neon "acordado" o tempo todo (~730 CU-h/mês x 0,25 CU ≈ $19/mês no Launch; **hipótese**). Self-hosted é o mais adequado aqui.

---

## 4. Transcrição

| Item | Preço | Unidade | Fonte (URL) | Status |
|---|---|---|---|---|
| OpenAI Whisper (whisper-1) | $0,006 | minuto | https://developers.openai.com/api/docs/pricing | ✅ |
| OpenAI gpt-4o-transcribe | $0,006 (estimado; $2,50/$10 por 1 M tokens) | minuto | https://developers.openai.com/api/docs/pricing | ✅ |
| **OpenAI gpt-4o-mini-transcribe** | **$0,003** (estimado; $1,25/$5 por 1 M tokens) | minuto | https://developers.openai.com/api/docs/pricing | ✅ |
| OpenAI gpt-transcribe (novo) | $0,0045 | minuto | https://developers.openai.com/api/docs/pricing | ✅ |
| OpenAI gpt-4o-transcribe-diarize | $0,006 | minuto | https://developers.openai.com/api/docs/pricing | ✅ |
| **Groq whisper-large-v3-turbo** | **$0,04** (~216x tempo real; mínimo de 10 s por requisição) | hora | https://console.groq.com/docs/speech-to-text | ✅ |
| Groq whisper-large-v3 | $0,111 | hora | https://console.groq.com/docs/speech-to-text | ✅ |
| Groq limite de arquivo | 25 MB (free) / 100 MB (dev), ou via parâmetro `url` | n/a | https://console.groq.com/docs/speech-to-text | ✅ |
| Deepgram Nova-3 Multilingual (pré-gravado) | $0,0052 | minuto | https://deepgram.com/pricing | ✅ |
| Deepgram Nova-3 Monolingual | $0,0043 | minuto | https://deepgram.com/pricing | ✅ |
| Deepgram crédito inicial | $200 sem expiração | único | https://deepgram.com/pricing | ✅ |
| AssemblyAI Universal-3.5 Pro | $0,21 | hora | https://www.assemblyai.com/pricing | ✅ (suporte a PT não confirmado: "18 idiomas") |
| AssemblyAI Universal-2 | $0,15 | hora | https://www.assemblyai.com/pricing | ✅ |
| AssemblyAI crédito inicial | $50 | único | https://www.assemblyai.com/pricing | ✅ |
| faster-whisper local (benchmark oficial) | modelo `small` int8 em i7-12700K com 8 threads: 13 min de áudio em 1m42s (~7,6x tempo real), 1,5 GB de RAM; com `batch_size=8`: 51 s | n/a | https://github.com/SYSTRAN/faster-whisper | ✅ (hardware desktop) |
| faster-whisper em VPS 4 vCPU compartilhada | `small` int8: ~2 a 4x tempo real; `medium`: ~1x; `large-v3` int8: abaixo do tempo real (0,3 a 0,8x) | n/a | inferido do benchmark acima | ❓ hipótese; medir na VPS |

**Custo para 15 a 270 min/mês (a maioria dos áudios tem menos de 10 min, então áudio de pt-BR curto):**
- gpt-4o-mini-transcribe: **$0,05 a $0,81/mês**
- Groq turbo: **$0,01 a $0,18/mês**
- Deepgram Nova-3 multi: $0,08 a $1,40 (na prática coberto pelos $200 de crédito)
- Local (faster-whisper `small`/`medium`): $0, mas consome ~1 a 3 min de CPU por vídeo e de 1,5 a 3 GB de RAM. A qualidade em pt-BR com gírias de games é inferior à do large-v3. Medir antes de decidir.

---

## 5. Busca para verificação factual

| Item | Preço | Unidade | Fonte (URL) | Status |
|---|---|---|---|---|
| Brave Search API (plano Search) | $5 por 1.000 requisições, com **$5 de crédito mensal** (~1.000 req grátis/mês), 50 req/s | 1.000 req | terceiros: https://apiserpent.com/blog/free-brave-search-api, https://vibecodehq.pages.dev/pricing/brave-search-api-pricing (página oficial https://api-dashboard.search.brave.com/app/plans não renderizou) | ❓ (consistente entre fontes, mas não lido na fonte oficial) |
| Tavily Researcher (free) | 1.000 créditos/mês | /mês | https://www.tavily.com/pricing | ✅ |
| Tavily pay-as-you-go | $0,008 por crédito; busca basic = 1 crédito, advanced = 2 | crédito | https://www.tavily.com/pricing, https://docs.tavily.com/documentation/api-credits | ✅ |
| Tavily Project | $30 por 4.000 créditos | /mês | https://www.tavily.com/pricing | ✅ |
| Exa Search | $7 por 1.000 (auto/fast); $4 por 1.000 (lite/instant); contents $1 por 1.000 páginas | 1.000 req | https://exa.ai/pricing | ✅ |
| Exa free | $10 de crédito que **renova todo mês** + $10 de bônus único | /mês | https://exa.ai/pricing | ✅ |
| SerpAPI | Free: 250 buscas/mês; Starter: $25 por 1.000 buscas/mês | /mês | https://serpapi.com/pricing | ✅ |
| OpenAI web search tool (referência) | $10 por 1.000 chamadas + tokens | 1.000 chamadas | https://developers.openai.com/api/docs/pricing | ✅ |
| Anthropic web search tool | não pesquisado (você já tem os preços da Anthropic) | n/a | n/a | n/a |

**Volume estimado:** 3 vídeos/dia x ~5 buscas ≈ 450 buscas/mês. **Cabe no free tier** de Brave ($5 de crédito), Tavily (1.000 créditos) ou Exa ($10/mês). Custo ≈ **$0**.

---

## 6. Observabilidade

| Item | Preço | Unidade | Fonte (URL) | Status |
|---|---|---|---|---|
| Sentry Developer (free) | $0: 1 usuário, 5k erros, 5 M spans, 50 replays, 5 GB de logs, 30 dias de histórico | /mês | https://sentry.io/pricing/ | ✅ |
| Sentry Team | $29 mensal / $26 no plano anual; usuários ilimitados, 50k erros | /mês | https://sentry.io/pricing/ | ✅ |
| Grafana Cloud Free | $0: 10k séries de métricas, 50 GB de logs, 50 GB de traces, 14 dias de retenção, 3 usuários, 100k checks sintéticos de API | /mês | https://grafana.com/pricing/ | ✅ |
| Grafana Cloud Pro | a partir de $19 + uso | /mês | https://grafana.com/pricing/ | ✅ |
| Axiom Personal (free) | $0: 500 GB/mês de ingest, 25 GB de storage, 30 dias de retenção, 10 GB-h de query | /mês | https://axiom.co/pricing | ✅ |
| Axiom Cloud | $25 + uso | /mês | https://axiom.co/pricing | ✅ |
| Better Stack free | 10 monitores/heartbeats, 1 status page, logs de 3 GB/mês com 3 dias de retenção | /mês | https://betterstack.com/pricing | ✅ |
| Better Stack Telemetry Nano | €25/mês (anual) / €30 (mensal) | /mês | https://betterstack.com/pricing | ✅ |
| Uptime Kuma (self-hosted) | $0, open source (MIT), mais um container na VPS | n/a | https://github.com/louislam/uptime-kuma | ❓ (licença não relida nesta coleta) |

Observação: o Uptime Kuma na mesma VPS não detecta a queda da própria VPS. Combine com Better Stack free ou Grafana Synthetics para fazer o check externo.

---

## 7. APIs das redes sociais

| Item | Preço | Unidade | Fonte (URL) | Status |
|---|---|---|---|---|
| Meta Graph API / Instagram Content Publishing | sem tarifa por chamada; limite de 100 posts via API por 24 h por conta | n/a | https://developers.facebook.com/docs/instagram-platform/content-publishing/ , https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ | ✅ limites / ❓ "gratuidade" (nenhuma página cita preço; ausência de preço inferida) |
| Meta: requisitos indiretos | conta IG profissional ligada a uma Página; permissões `instagram_content_publish` etc.; **Advanced Access exige Business Verification** (desde 2023) e App Review | n/a | https://developers.facebook.com/blog/post/2023/02/01/developer-platform-requiring-business-verification-for-advanced-access/ | ✅ (exigência) |
| Meta Business Verification: custo | sem tarifa conhecida; exige CNPJ/documentos e domínio. Custo indireto: tempo (dias a semanas) | n/a | fontes de terceiros conflitantes | ❓ |
| Meta Verified for Business (selo, **não necessário** para a API) | a partir de ~$21,99/mês por conta | /mês | https://nowbam.com/meta-verified-for-business-accounts-what-do-you-get-for-21-99-a-month/ | ❓ (terceiros) |
| TikTok Content Posting API | sem tarifa citada na doc; **cliente não auditado publica apenas em modo privado**; precisa de auditoria para publicar público | n/a | https://developers.tiktok.com/doc/content-posting-api-get-started | ✅ restrição / ❓ gratuidade (inferida) |
| TikTok custo indireto | verificação de domínio (PULL_FROM_URL), auditoria do app, política de privacidade/termos públicos | n/a | https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide | ✅ |
| YouTube Data API v3 | sem cobrança monetária citada; cota padrão de **100 `videos.insert`/dia** (bucket próprio), 100 `search.list`/dia e 10.000 unidades/dia para o resto; `thumbnails.set` = 50 unidades; aumento via formulário de extensão de cota | n/a | https://developers.google.com/youtube/v3/determine_quota_cost , https://developers.google.com/youtube/v3/getting-started | ✅ cotas / ❓ gratuidade (inferida) |
| YouTube: projetos não verificados | a doc atual diz: *"Videos uploaded from unverified API projects are not restricted to private viewing mode."* (antes, projetos criados após jul/2020 ficavam restritos a privado até a auditoria) | n/a | https://developers.google.com/youtube/v3/docs/videos/insert | ✅ (texto lido em 2026-11-15; testar mesmo assim) |
| Google OAuth: verificação do app | escopo `youtube.upload` é sensível; app em modo "testing" tem tokens que expiram em 7 dias. Verificação é gratuita | n/a | não verificado nesta coleta | ❓ |

---

## 8. Estimativa mensal consolidada (volume de 1 a 3 vídeos/dia)

| Componente | Escolha recomendada | Custo estimado/mês |
|---|---|---|
| VPS | Hetzner CPX32 HEL1 (4 vCPU/8 GB) €30,49, ou CX33 €8,99 quando houver estoque | €9 a €36 (~US$10 a 42) |
| VPS (alternativa BR) | Hostinger KVM 4 (4 vCPU/16 GB) | R$ 60 promo / R$ 150 na renovação |
| PostgreSQL | self-hosted na VPS + `pg_dump` diário no R2 | $0 |
| Storage | Cloudflare R2 (custom domain) | $0 a $1 |
| Transcrição | gpt-4o-mini-transcribe (ou Groq turbo) | $0,05 a $0,81 |
| Busca | Tavily free ou Brave ($5 de crédito) | $0 |
| Observabilidade | Sentry free + Grafana Cloud free (ou Axiom free) + Better Stack free (uptime externo) | $0 |
| APIs sociais | Meta / TikTok / YouTube | $0 (custo indireto: verificação/auditoria) |
| **Total (sem LLM)** | | **~US$ 12 a 45/mês** |
