import { ConstructPanel, MODULE_ID } from "./construct-panel.js";

let panel = null;

function togglePanel() {
  if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("LSC.Err.NotGM"));
  panel ??= new ConstructPanel(); // instância única
  if (panel.rendered) panel.close();
  else panel.render({ force: true });
}

Hooks.once("init", () => {
  // Coleções de tilesets: apenas nomes, ids e caminhos. Escopo do mundo (edição restrita ao mestre).
  game.settings.register(MODULE_ID, "tilesets", {
    scope: "world",
    config: false,
    type: Object,
    default: { sets: [] }
  });
});

// v13: "controls" é um objeto indexado pelo nome do grupo; "tools" também é um objeto.
Hooks.on("getSceneControlButtons", controls => {
  if (!game.user?.isGM) return;
  const tiles = controls.tiles;
  if (!tiles?.tools) return;
  tiles.tools.lscConstruct = {
    name: "lscConstruct",
    title: "LSC.Title",
    icon: "fa-solid fa-hammer",
    order: Object.keys(tiles.tools).length,
    button: true,
    visible: game.user.isGM,
    onChange: () => togglePanel()
  };
});
