# Palavrinhas da Manu 🐳

Um caderninho digital das palavras que a Manu vai aprendendo. Cada palavra vira
um card com imagem, nome, legenda e categoria (família, animais, comidas, outros),
organizado por data: as mais recentes no topo e as mais antigas no rodapé.

## Onde ficam as palavras

Tudo fica dentro deste repositório, sem banco de dados nem serviço externo:

- `public/data/palavras.json`: a lista de palavras
- `public/data/imagens/`: as imagens (reduzidas para no máximo 1000px antes de salvar)

Quando você cria, edita ou apaga uma palavra pela página, ela faz **um commit** no
repositório pela API do GitHub. O histórico do git vira o histórico das palavrinhas.

> ⚠️ O repositório é **público**: qualquer pessoa pode ver as palavras e as imagens,
> tanto no site quanto aqui no GitHub.

## Configuração (uma vez só)

### 1. Publicar o site no GitHub Pages

1. No GitHub, vá em **Settings → Pages** e em *Source* escolha **GitHub Actions**.
2. Rode **Actions → Publicar no GitHub Pages → Run workflow** (depois disso, cada commit
   que mexa em `public/` na branch principal republica sozinho, em cerca de 1 minuto).
3. O endereço fica `https://diegordrgs.github.io/palavrinhas/`.

### 2. Criar o token para poder editar

Quem só abre o site vê as palavras. Para editar, é preciso um token do GitHub:

1. Acesse https://github.com/settings/personal-access-tokens/new (*fine-grained token*).
2. *Repository access*: **Only select repositories** → `palavrinhas`.
3. *Permissions → Repository permissions → Contents*: **Read and write**.
4. Escolha a validade (pode ser até 1 ano) e gere o token.
5. No site, clique em **entrar para editar** (canto superior esquerdo) e cole o token.

O token fica guardado só naquele navegador (localStorage). Faça isso uma vez em cada aparelho.
Para tirar, use **sair da edição**. Se o token vazar, apague-o em
https://github.com/settings/personal-access-tokens.

## Rodar no computador

```bash
python3 -m http.server 3000 --directory public
```

e abra http://localhost:3000. Mesmo rodando localmente, ao salvar a página grava no GitHub.
Lembre de dar `git pull` depois para trazer as palavras novas.

## Uso

- **+ Nova palavra**: abre o formulário (imagem, palavra, legenda, categoria e data em que aprendeu).
- **Clicar em um card** (no modo de edição): edita ou apaga a palavra.
- **Busca**: procura no nome e na legenda (sem se importar com acentos).
- **Categorias**: filtram os cards.
- **Linha do tempo** (lateral, ou faixa no topo no celular): pula direto para um mês.
- Cada card mostra o número da palavra na ordem em que foi aprendida (nº 001 = a primeira) e a data.
