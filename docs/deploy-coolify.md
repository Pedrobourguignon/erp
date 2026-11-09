# Deploy da API no Coolify (validação com cliente)

Passo a passo para subir **Postgres, Redis, MinIO e a API** numa VPS com Coolify.
O que está marcado como **(verificado)** foi testado construindo e rodando a imagem
localmente. Os nomes de menus do Coolify mudam entre versões: trate-os como guia.

> **Escopo.** Este guia cobre o banco e a API. O front (`apps/web`) tem o mesmo
> defeito de Dockerfile que a API tinha (`COPY --from=deps /app/apps/web/node_modules`,
> pasta que não existe) e **não foi corrigido nem testado**. Veja a seção
> [Front](#front).

---

## 0. Antes de começar

| Item | Detalhe |
|---|---|
| Domínio | Um subdomínio para a API, ex.: `api-erp.seudominio.com`, com registro **A** apontando para o IP da VPS. |
| Recursos da VPS | Postgres + Redis + MinIO + API somam algumas centenas de MB ociosos; deixe folga para o outro projeto que já roda lá. Confira com `free -h`. |
| Repositório | O Coolify precisa de acesso ao GitHub (GitHub App ou deploy key). Faça deploy da branch `main`. |
| Segredos | Gere um por variável: `openssl rand -base64 48`. **Nunca** reaproveite os do ambiente local. |

---

## 1. Projeto e rede

1. Crie um projeto, ex. `erp-validacao`, com um environment `production`.
2. Crie **todos os recursos abaixo no mesmo servidor e na mesma "destination"**.
   Recursos em redes Docker diferentes não se enxergam pelo nome, e o sintoma é
   `ENOTFOUND` ou `ECONNREFUSED` na API. Se criar o MinIO como *Service*, ative nele
   (e na API) a opção **Connect to Predefined Network**.

---

## 2. Postgres

1. *New Resource → Database → PostgreSQL 16.*
2. **Não** ative "Make it publicly available".
3. Anote a **URL interna** (host é o nome do container, ex. `abc123def`). A
   `DATABASE_URL` da API será essa URL com `?schema=public` no fim:
   ```
   postgresql://USUARIO:SENHA@HOST_INTERNO:5432/NOME?schema=public
   ```
   Se a senha tiver caracteres especiais (`@ : / ? # %`), faça *URL-encode*.
4. Ative o **backup agendado** (seção 8) agora, não depois.

---

## 3. Redis

A API usa o Redis para a **fila de importação** (BullMQ). O Redis do Coolify nasce
**com senha**, e a API agora lê `REDIS_PASSWORD` **(verificado)**.

1. *New Resource → Database → Redis.* Não exponha publicamente.
2. Anote host interno, porta (6379) e a senha.
3. **Política de memória:** o BullMQ exige `maxmemory-policy noeviction`. Com o padrão
   `allkeys-lru`, o Redis pode apagar jobs da fila sob pressão de memória (o Redis
   local do `docker-compose` está assim e avisa nos logs). Defina `noeviction` na
   configuração customizada do Redis no Coolify.

> **Nunca compartilhe este Redis com outro ambiente ou projeto.** A fila se chama
> `imports`; um worker de outro ambiente que consuma o mesmo Redis pega o job, não
> acha o registro no banco dele e o descarta. O job do seu ambiente fica `PENDING`
> para sempre, sem erro nenhum. Isso aconteceu nos testes **(verificado)**.

---

## 4. MinIO (arquivos das importações)

1. *New Resource → Service → MinIO* (ou outro serviço S3-compatível).
2. Defina usuário e senha de root fortes. Não exponha o console publicamente.
3. Anote o host interno e a porta da API S3 (9000).
4. **Não crie o bucket:** a API cria o bucket de `MINIO_BUCKET` sozinha na primeira
   gravação **(verificado)**.

---

## 5. API

1. *New Resource → Application → repositório → branch `main`.*
2. **Build Pack:** `Dockerfile`.
3. **Base Directory:** `/` (a raiz do monorepo: o build precisa de `packages/`).
4. **Dockerfile Location:** `/apps/api/Dockerfile`.
5. **Docker build target:** deixe em branco. O estágio de produção é o último do
   arquivo, então um build padrão gera produção **(verificado)**. Se preencher, use
   `production`.
6. **Port exposes:** `3001`.
7. **Domain:** `https://api-erp.seudominio.com` (o Coolify emite o certificado).
8. **Health check:** path `/api/v1/health`, porta `3001`. O `HEALTHCHECK` do
   Dockerfile já faz isso.
9. **Variáveis de ambiente:**

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `DATABASE_URL` | URL interna do Postgres + `?schema=public` |
| `REDIS_HOST` / `REDIS_PORT` | host interno / `6379` |
| `REDIS_PASSWORD` | senha do Redis |
| `MINIO_ENDPOINT` | host interno do MinIO (sem `http://`) |
| `MINIO_PORT` | `9000` |
| `MINIO_USE_SSL` | `false` (tráfego interno) |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | credenciais do MinIO |
| `MINIO_BUCKET` | ex. `erp-files` |
| `JWT_SECRET` | segredo forte, **obrigatório** |
| `JWT_REFRESH_SECRET` | outro segredo forte, **obrigatório** |
| `CORS_ORIGINS` | origens do front, separadas por vírgula, ex. `https://erp.seudominio.com` |
| `RUN_MIGRATIONS` | `true` **só no primeiro deploy** e nos que trouxerem migration |

> **Atenção com `JWT_SECRET`.** Se a variável faltar, a API sobe usando o valor
> padrão `change-me-in-production`, **sem avisar**. Confirme que está definida.

> **Atenção com CORS.** Antes desta correção o código só lia `CORS_ORIGIN`
> (singular), enquanto o `.env.example` documentava `CORS_ORIGINS`. Agora os dois
> nomes funcionam e aceita lista **(verificado)**. Se a origem estiver errada, o
> navegador bloqueia as chamadas e o erro aparece só no console do navegador.

10. **Deploy.** Nos logs, procure:
    ```
    [entrypoint] Applying database migrations...
    All migrations have been successfully applied.
    ERP API running on port 3001
    ```
    São 15 migrations do zero **(verificado)**. Depois do primeiro deploy, **remova
    `RUN_MIGRATIONS` ou ponha `false`**: uma migration é mudança de schema em dados
    reais e deve ser decisão consciente de cada deploy.

11. Teste: `curl https://api-erp.seudominio.com/api/v1/health` deve responder `200`.
    O Swagger fica desligado em produção.

---

## 6. Criar a empresa do cliente

No Coolify, abra o **Terminal** da aplicação da API (ou use `docker exec` na VPS):

```bash
node dist/database/onboarding/onboard-tenant.cli.js \
  --name "Nome da Empresa Ltda" \
  --document 11.222.333/0001-81 \
  --owner-name "Nome do Dono" \
  --owner-email dono@empresa.com.br
```

Sem `--password`, ele gera uma senha forte e a mostra **uma única vez**. A senha não
pode conter o nome nem o e-mail do dono. O comando recusa CNPJ repetido, então
rodar duas vezes não afeta uma empresa em uso **(verificado dentro da imagem de
produção)**. Oriente o dono a trocar a senha no primeiro acesso: o sistema ainda não
força essa troca.

---

## 7. Importar os produtos

**Pela API**, sem precisar do front **(verificado)**:

```bash
TOKEN=$(curl -s -X POST https://api-erp.seudominio.com/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"dono@empresa.com.br","password":"SENHA"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')

curl -X POST https://api-erp.seudominio.com/api/v1/imports/products \
  -H "authorization: Bearer $TOKEN" \
  -F "file=@Exportacao-de-produtos.xlsx"
```

A resposta traz o `id` do job. Consulte `GET /api/v1/imports/<id>` até o `status`
ser `COMPLETED`. Com a planilha da DELICATTA: 3.293 linhas importadas e 2.332
avisos. Reenviar o mesmo arquivo não duplica nada (produtos já existentes, por SKU,
são mantidos).

Se o job ficar em `PENDING`, veja a seção 3: outro ambiente está consumindo o mesmo
Redis, ou o Redis não está acessível.

---

## 8. Backup e restauração

1. No recurso do Postgres: *Backups → Schedule* (diário) e configure um **destino
   S3 externo**. Backup guardado na mesma VPS não protege contra perder a VPS.
2. **Teste a restauração** num Postgres separado antes de colocar dados reais do
   cliente. Um backup que nunca foi restaurado é uma suposição.
3. Os arquivos das importações ficam no volume do MinIO; para a validação, o banco
   é o que importa.

---

## 9. Front

O `NEXT_PUBLIC_API_URL` do Next.js é **fixado na hora do build**, então o front
precisa ser construído já com a URL da API de produção. Opções:

- **Rápido, para validar:** rodar o front local (`npm run dev -w @erp/web`) com
  `NEXT_PUBLIC_API_URL=https://api-erp.seudominio.com/api/v1`, e incluir
  `http://localhost:3000` em `CORS_ORIGINS`. Só você acessa.
- **Para o cliente acessar:** publicar o front (Coolify ou Vercel). Pelo defeito do
  Dockerfile acima, isso exige consertá-lo primeiro.

---

## 10. Checklist de validação

- [ ] `GET /api/v1/health` responde `200` pelo domínio, com HTTPS válido
- [ ] Postgres e Redis **sem** porta pública (`nmap`/`telnet` de fora recusam)
- [ ] `JWT_SECRET` e `JWT_REFRESH_SECRET` definidos e diferentes do ambiente local
- [ ] `RUN_MIGRATIONS` desligado depois do primeiro deploy
- [ ] Login da empresa funciona; senha inicial já trocada
- [ ] Importação de produtos chega a `COMPLETED`
- [ ] Backup agendado **e** restauração testada
- [ ] Redis com `maxmemory-policy noeviction`
- [ ] Nenhum outro ambiente usa este Redis

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Deploy cai com `ENOTFOUND` / `ECONNREFUSED` | Recursos em redes diferentes (seção 1), ou host interno errado |
| `NOAUTH` / `WRONGPASS` nos logs | `REDIS_PASSWORD` ausente ou errado |
| Importação eternamente `PENDING` | Outro ambiente no mesmo Redis, ou Redis inacessível |
| Front carrega mas as chamadas falham | `CORS_ORIGINS` sem a origem exata (esquema + domínio, sem barra no final) |
| Container "unhealthy" no Coolify | Health check apontando para `/health` em vez de `/api/v1/health` |
| `P1000`/`P1001` do Prisma | `DATABASE_URL` errada, ou senha sem *URL-encode* |
