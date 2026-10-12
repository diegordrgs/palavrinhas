# Palavrinhas da Manu 🐳

Um caderninho digital das palavras que a Manu vai aprendendo. Cada palavra vira
um card com imagem, nome, legenda e categoria (família, animais, comidas, outros),
organizado por data: as mais recentes no topo e as mais antigas no rodapé.

## Como rodar

Precisa só do [Node.js](https://nodejs.org) 22.13 ou mais novo. Não há dependências para instalar.

```bash
npm start
```

Depois é só abrir http://localhost:3000.

## Onde ficam os dados

Tudo fica na pasta `data/` (ignorada pelo git):

- `data/palavrinhas.db`: banco SQLite com as palavras
- `data/uploads/`: as imagens enviadas (reduzidas para no máximo 1000px no navegador)

Para fazer backup, basta copiar a pasta `data/`.

Variáveis opcionais:

- `PORT`: porta do servidor (padrão `3000`)
- `DATA_DIR`: outra pasta para guardar os dados

## Uso

- **+ Nova palavra**: abre o formulário (imagem, palavra, legenda, categoria e data em que aprendeu).
- **Clicar em um card**: edita ou apaga a palavra.
- **Busca**: procura no nome e na legenda (sem se importar com acentos).
- **Categorias**: filtram os cards.
- **Linha do tempo** (lateral, ou faixa no topo no celular): pula direto para um dia.
