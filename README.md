# Palavrinhas da Manu 🐳

Um caderninho digital das palavras que a Manu vai aprendendo. Cada palavra vira
um card com imagem, nome, legenda e categoria (família, animais, comidas, outros),
organizado por data: as mais recentes no topo e as mais antigas no rodapé.

- A página é um site estático (pasta `public/`), publicado no **GitHub Pages**.
- As palavras e as imagens ficam no **Supabase** (banco Postgres + armazenamento de arquivos, plano gratuito).
- Só entra quem tiver login: ninguém de fora vê as palavras nem as fotos, mesmo o repositório sendo público.

## Configuração (uma vez só)

### 1. Criar o projeto no Supabase

1. Crie uma conta em https://supabase.com e um projeto novo (região São Paulo, se quiser).
2. Abra **SQL Editor**, cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.
   Isso cria a tabela `words`, o bucket privado `imagens` e as regras de acesso.

### 2. Criar os logins da família

1. Em **Authentication → Sign In / Providers**, **desligue** a opção *Allow new users to sign up*.
   Assim ninguém consegue criar conta sozinho.
2. Em **Authentication → Users**, clique em **Add user → Create new user** e cadastre e-mail e senha
   de cada pessoa que pode usar (marque *Auto Confirm User*).

### 3. Ligar a página ao Supabase

Em **Project Settings → API**, copie a **Project URL** e a chave **anon / publishable** e cole em
[`public/config.js`](public/config.js). Essa chave pode ficar no repositório público: quem protege os
dados são as regras do passo 1, que exigem login. (Nunca coloque a chave `service_role` / `secret` aqui.)

### 4. Publicar no GitHub Pages

1. No GitHub, vá em **Settings → Pages** e em *Source* escolha **GitHub Actions**.
2. A cada push que mexa em `public/` na branch principal, o workflow
   [`.github/workflows/pages.yml`](.github/workflows/pages.yml) publica o site.
   Também dá para rodar manualmente em **Actions → Publicar no GitHub Pages → Run workflow**.
3. O endereço fica algo como `https://diegordrgs.github.io/palavrinhas/`.

## Rodar no computador

Qualquer servidor de arquivos estáticos serve, por exemplo:

```bash
python3 -m http.server 3000 --directory public
```

e abra http://localhost:3000. Os dados são os mesmos do site, porque vêm do Supabase.

## Uso

- **+ Nova palavra**: abre o formulário (imagem, palavra, legenda, categoria e data em que aprendeu).
  A imagem é reduzida no navegador (máx. 1000px) antes de ser enviada.
- **Clicar em um card**: edita ou apaga a palavra.
- **Busca**: procura no nome e na legenda (sem se importar com acentos).
- **Categorias**: filtram os cards.
- **Linha do tempo** (lateral, ou faixa no topo no celular): pula direto para um dia.

## Bom saber

- No plano gratuito, o Supabase **pausa projetos sem uso por uma semana**. Os dados não se perdem;
  basta entrar no painel do Supabase e clicar em *Restore project*.
- Backup: **Database → Backups** no painel, ou exporte a tabela `words` em CSV pelo **Table Editor**.
  As imagens ficam em **Storage → imagens**.
