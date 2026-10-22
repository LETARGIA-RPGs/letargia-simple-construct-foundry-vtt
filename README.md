# LETARGIA SIMPLE CONSTRUCT

Módulo para Foundry VTT 13 (independente de sistema, somente mestre) que monta mapas com tiles reais da cena.

## Instalação
1. Copie a pasta `letargia-simple-construct` para `Data/modules/` (ou extraia o ZIP ali).
2. Reinicie/recarregue o Foundry, ative o módulo no mundo.
3. Como mestre, abra os controles **Tiles** (barra esquerda): o botão do martelo "LETARGIA SIMPLE CONSTRUCT" abre/fecha o painel.

## Uso rápido
- **Escolher imagem** abre o seletor nativo. **Posicionar** mostra uma prévia no cursor; clique confirma, Esc ou botão direito cancela, Shift = posição livre, Ctrl/Cmd+clique = repetir. Também é possível arrastar a miniatura do painel para o mapa.
- **Criar/abrir tileset**: crie uma coleção, adicione imagens, clique (ou arraste) uma miniatura para posicionar. O × remove só a referência.
- Camadas das novas peças: **Piso < Estrutura < Decoração** (faixas do campo `sort` do Tile; mesma elevação).
- Peça ativa: aumentar/diminuir (~10 %), girar 15°, cadeado (nativo `locked`), **Andar** (elevação) e **Altura** (topo, só se o módulo Levels estiver ativo).
- A lista "Peças desta cena" seleciona qualquer peça do módulo, mesmo travada/escondida, sem destravá-la.

## Roteiro de teste manual
1. Ativar o módulo, abrir Tiles → botão do martelo → painel abre (só para o mestre; jogadores não veem o botão).
2. Escolher imagem PNG/WEBP; clicar Posicionar; mover o mouse com zoom/pan alterados; clicar → um tile, encaixado na grade. Esc durante a prévia não cria nada.
3. Repetir com Shift (livre) e arrastando a miniatura do painel.
4. Criar tileset, adicionar 3 imagens, reabrir pelo seletor, remover uma referência (arquivo permanece).
5. Colocar Piso, Estrutura e Decoração sobrepostos; criar outro Piso depois: deve ficar acima do Piso anterior e abaixo da Estrutura. Recarregar (F5): ordem preservada.
6. Aumentar, diminuir, girar, arrastar (peça destravada, camada Tiles ativa).
7. Travar: arraste não move; botões de tamanho/rotação desabilitados. Recarregar: continua travada. Selecionar pela lista → destravar pelo cadeado do painel.
8. Trocar de cena durante a prévia: sem prévia/listeners restantes. Desativar o módulo: tiles continuam no mapa.
9. Conferir o console (F12) sem erros.

## Limitações reais
- **Não foi executado dentro do Foundry.** Foram feitas apenas verificações estáticas (sintaxe JS/JSON, template balanceado, chaves de tradução e ações) e conferência de assinaturas na documentação v13. Teste antes de usar em jogo.
- O botão fica no grupo **Tiles** (em v13 `controls` é um objeto e a ferramenta é `button`), não em um grupo novo.
- Levels: o módulo grava `elevation` nativa e, se o Levels estiver ativo, `flags.levels.rangeBottom/rangeTop`. Essas chaves seguem o contrato conhecido do Levels e **não foram validadas com a versão instalada**. Não há uso de métodos da API do Levels (não confirmados). Elevação acima da elevação de primeiro plano da cena torna o tile "overhead" nativamente.
- Ordenação: o `sort` só ordena tiles na mesma elevação; tiles não criados pelo módulo não são reorganizados. Cada camada comporta 1.000.000 peças.
- Posição/tamanho usam inteiros; ao redimensionar, o centro pode variar até 0,5 px.
- Miniaturas usam as imagens originais (`loading="lazy"`); imagens enormes ainda são decodificadas pelo navegador.
- O encaixe usa `canvas.tiles.getSnappedPoint`. O modificador livre implementado é **Shift** (`event.shiftKey`); confirme se coincide com o do seu Foundry.
- O `module.json` não tem URLs de manifesto/download e não declara versão verificada. O mesmo arquivo de idioma é registrado também como `en` para que a interface apareça em português em qualquer idioma do cliente.
