export const MODULE_ID = "letargia-simple-construct";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Camadas visuais: de baixo para cima. Cada uma ocupa uma faixa do campo nativo "sort" do Tile. */
const LAYERS = [
  { key: "floor", label: "LSC.Layer.floor", base: 1_000_000 },
  { key: "structure", label: "LSC.Layer.structure", base: 2_000_000 },
  { key: "decor", label: "LSC.Layer.decor", base: 3_000_000 }
];
const BAND = 1_000_000;
const DROP_TYPE = "LetargiaSimpleConstruct";
const IMG_RE = /\.(png|webp|jpe?g|avif|gif|svg)$/i;
const SCALE_STEP = 1.1;
const ROT_STEP = 15;
const MIN_SIZE = 16;
const MAX_SIZE = 20000;

/* ------------------------------ utilitários ------------------------------ */

const i18n = key => game.i18n.localize(key);
const notify = (key, type = "warn") => ui.notifications[type](game.i18n.localize(key));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const canvasEl = () => canvas?.app?.view ?? canvas?.app?.canvas ?? null;
const levelsActive = () => !!game.modules.get("levels")?.active;
const modFlags = doc => doc?.flags?.[MODULE_ID] ?? {};

function nameFromSrc(src) {
  const base = String(src).split("?")[0].split("/").pop().replace(/\.[^.]+$/, "");
  try { return decodeURIComponent(base); } catch { return base; }
}

/** URL segura apenas para <img> do painel (o tile guarda o caminho exatamente como o FilePicker devolveu). */
function toUrl(src) {
  if (/^https?:\/\//i.test(src)) return src;
  try { return encodeURI(decodeURI(src)); } catch { return src; }
}

const sizeCache = new Map();
/** Lê dimensões naturais da imagem (também valida que ela carrega). */
function loadImageSize(src) {
  if (sizeCache.has(src)) return Promise.resolve(sizeCache.get(src));
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const s = img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null;
      if (s) sizeCache.set(src, s);
      resolve(s);
    };
    img.onerror = () => resolve(null);
    img.src = toUrl(src);
  });
}

/** Tamanho inicial utilizável: mantém proporção e limita entre 0,5 e 6 células de grade. */
function initialSize(nw, nh) {
  const grid = canvas.grid?.size || canvas.dimensions?.size || 100;
  const big = Math.max(nw, nh);
  let s = 1;
  if (big > grid * 6) s = (grid * 6) / big;
  else if (big < grid * 0.5) s = (grid * 0.5) / big;
  return { width: Math.max(1, Math.round(nw * s)), height: Math.max(1, Math.round(nh * s)) };
}

/** Coordenada de tela (clientX/Y) → coordenada do canvas, considerando zoom e deslocamento. */
function clientToCanvas(clientX, clientY) {
  if (typeof canvas.canvasCoordinatesFromClient === "function") {
    const p = canvas.canvasCoordinatesFromClient({ x: clientX, y: clientY });
    return { x: p.x, y: p.y };
  }
  const t = canvas.stage.worldTransform;
  return { x: (clientX - t.tx) / canvas.stage.scale.x, y: (clientY - t.ty) / canvas.stage.scale.y };
}

/** Canto superior esquerdo para um centro dado, usando o encaixe nativo da camada de tiles. */
function topLeftFor(center, w, h, free) {
  let x = center.x - w / 2;
  let y = center.y - h / 2;
  if (!free && canvas.grid && !canvas.grid.isGridless) {
    const pt = typeof canvas.tiles?.getSnappedPoint === "function"
      ? canvas.tiles.getSnappedPoint({ x, y })
      : canvas.grid.getSnappedPoint({ x, y }, { mode: CONST.GRID_SNAPPING_MODES.VERTEX });
    x = pt.x;
    y = pt.y;
  }
  return { x, y };
}

/* --------------------------------- painel -------------------------------- */

export class ConstructPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "letargia-simple-construct-panel",
    classes: ["lsc-app"],
    tag: "div",
    window: { title: "LSC.Title", icon: "fa-solid fa-hammer", resizable: false },
    position: { width: 310, height: "auto" },
    actions: {
      pickImage() { return this.#pickImage(); },
      toggleSets() { this.#showSets = !this.#showSets; this.#rerender(); },
      setLayer(event, target) { this.#layer = target.dataset.layer; this.#rerender(); },
      place() { return this.#placing ? (this.#cancelPlacement(), this.#rerender()) : this.#startPlacement(this.#src); },
      addCurrent() { return this.#addToSet(this.#src); },
      newSet() { return this.#createSet(); },
      deleteSet() { return this.#deleteSet(); },
      addToSet() { return this.#addImageToSet(); },
      placeThumb(event, target) { return this.#thumbPlace(target.dataset.src); },
      removeThumb(event, target) { return this.#removeThumb(target.dataset.id); },
      selectTile(event, target) { return this.#selectTile(target.dataset.id); },
      scaleUp() { return this.#scale(SCALE_STEP); },
      scaleDown() { return this.#scale(1 / SCALE_STEP); },
      rotateCW() { return this.#rotate(ROT_STEP); },
      rotateCCW() { return this.#rotate(-ROT_STEP); },
      toggleLock() { return this.#toggleLock(); }
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/construct-panel.hbs` }
  };

  #src = null;
  #layer = "floor";
  #setId = null;
  #showSets = false;
  #activeId = null;
  #bottom = "";
  #top = "";
  #lastDir = "";
  #placing = null;
  #token = 0;
  #busy = false;
  #hooks = [];
  #refresh = foundry.utils.debounce(() => this.#rerender(), 60);

  /* ------------------------------ ciclo de vida ----------------------------- */

  #rerender() {
    if (this.rendered) this.render();
  }

  #hook(name, fn) {
    this.#hooks.push([name, Hooks.on(name, fn)]);
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.#hook("canvasTearDown", () => {
      this.#cancelPlacement();
      this.#activeId = null;
      this.#refresh();
    });
    this.#hook("canvasReady", () => this.#refresh());
    this.#hook("controlTile", (tile, controlled) => {
      const d = tile?.document;
      if (controlled && d && modFlags(d).layer && d.id !== this.#activeId) {
        this.#activeId = d.id;
        this.#refresh();
      }
    });
    const onDoc = doc => {
      if (doc.parent?.id === canvas?.scene?.id && modFlags(doc).layer) this.#refresh();
    };
    this.#hook("createTile", onDoc);
    this.#hook("updateTile", onDoc);
    this.#hook("deleteTile", doc => {
      if (doc.id === this.#activeId) {
        this.#activeId = null;
        notify("LSC.Err.TileRemoved");
      }
      onDoc(doc);
    });
    // Soltar uma peça (arrastada do painel) sobre o mapa. data.x/y já vêm em coordenadas do canvas.
    this.#hook("dropCanvasData", (cv, data, event) => {
      if (data?.type !== DROP_TYPE) return;
      this.#onDrop(data, event);
      return false;
    });
  }

  _onClose(options) {
    this.#cancelPlacement();
    for (const [name, id] of this.#hooks) Hooks.off(name, id);
    this.#hooks = [];
    super._onClose?.(options);
  }

  async _prepareContext() {
    const scene = canvas?.ready ? canvas.scene : null;
    const sets = this.#sets();
    if (this.#setId && !sets.some(s => s.id === this.#setId)) this.#setId = null;
    const current = sets.find(s => s.id === this.#setId) ?? null;
    const layerLabel = key => i18n(LAYERS.find(l => l.key === key)?.label ?? "LSC.Piece");

    const docs = scene ? scene.tiles.filter(t => modFlags(t).layer) : [];
    docs.sort((a, b) => b.sort - a.sort);
    const active = this.#activeDoc();
    if (this.#activeId && !active) this.#activeId = null;

    let bottom = this.#bottom;
    let top = this.#top;
    if (active) {
      bottom = active.flags?.levels?.rangeBottom ?? active.elevation ?? "";
      top = active.flags?.levels?.rangeTop ?? "";
    }

    return {
      hasScene: !!scene,
      src: this.#src,
      srcUrl: this.#src ? toUrl(this.#src) : "",
      srcName: this.#src ? nameFromSrc(this.#src) : "",
      placing: !!this.#placing,
      showSets: this.#showSets,
      layers: LAYERS.map(l => ({ key: l.key, label: i18n(l.label), active: l.key === this.#layer })),
      sets: sets.map(s => ({ id: s.id, name: s.name, selected: s.id === this.#setId })),
      currentSet: !!current,
      items: (current?.items ?? []).map(i => ({ id: i.id, src: i.src, url: toUrl(i.src), name: nameFromSrc(i.src) })),
      active: active ? {
        name: modFlags(active).name || i18n("LSC.Piece"),
        layerLabel: layerLabel(modFlags(active).layer),
        locked: active.locked
      } : null,
      tiles: docs.map(d => ({
        id: d.id,
        name: modFlags(d).name || i18n("LSC.Piece"),
        layerLabel: layerLabel(modFlags(d).layer),
        locked: d.locked,
        active: d.id === this.#activeId
      })),
      bottom,
      top,
      levelsActive: levelsActive(),
      levelsDisabled: !!active?.locked
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    el.querySelector('select[name="setId"]')?.addEventListener("change", ev => {
      this.#setId = ev.currentTarget.value || null;
      this.#rerender();
    });
    el.querySelector('input[name="newSetName"]')?.addEventListener("keydown", ev => {
      if (ev.key === "Enter") { ev.preventDefault(); this.#createSet(); }
    });
    el.querySelectorAll('input[name="bottom"], input[name="top"]').forEach(i =>
      i.addEventListener("change", () => this.#onLevels()));
    el.querySelectorAll('[draggable="true"]').forEach(n =>
      n.addEventListener("dragstart", ev => this.#onDragStart(ev)));
  }

  #onDragStart(ev) {
    const src = ev.currentTarget.dataset.src;
    if (!src) return;
    ev.dataTransfer.setData("text/plain", JSON.stringify({ type: DROP_TYPE, src, name: ev.currentTarget.dataset.name }));
    ev.dataTransfer.effectAllowed = "copy";
  }

  /* --------------------------------- guardas -------------------------------- */

  #guard(needCanvas = true) {
    if (!game.user.isGM) { notify("LSC.Err.NotGM"); return false; }
    if (needCanvas) {
      if (!canvas?.ready) { notify("LSC.Err.CanvasNotReady"); return false; }
      if (!canvas.scene) { notify("LSC.Err.NoScene"); return false; }
    }
    return true;
  }

  #activeDoc() {
    return this.#activeId ? canvas?.scene?.tiles.get(this.#activeId) : undefined;
  }

  /* -------------------------------- tilesets -------------------------------- */

  #sets() {
    const data = game.settings.get(MODULE_ID, "tilesets");
    return structuredClone(data?.sets ?? []);
  }

  async #saveSets(sets) {
    try {
      await game.settings.set(MODULE_ID, "tilesets", { sets });
      return true;
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      notify("LSC.Err.Failed", "error");
      return false;
    }
  }

  #openPicker(callback) {
    const FP = foundry.applications.apps?.FilePicker?.implementation ?? foundry.applications.apps?.FilePicker;
    new FP({
      type: "image",
      current: this.#lastDir,
      callback: async path => {
        if (!path || !IMG_RE.test(path.split("?")[0])) return notify("LSC.Err.BadFile");
        const size = await loadImageSize(path);
        if (!size) return notify("LSC.Err.BadImage");
        const i = path.lastIndexOf("/");
        if (i > 0) this.#lastDir = path.slice(0, i);
        callback(path);
      }
    }).render({ force: true });
  }

  #pickImage() {
    if (!this.#guard(false)) return;
    this.#openPicker(path => {
      this.#src = path;
      this.#rerender();
    });
  }

  async #createSet() {
    if (!this.#guard(false)) return;
    const name = this.element?.querySelector('input[name="newSetName"]')?.value.trim();
    if (!name) return notify("LSC.Err.EmptyName");
    const sets = this.#sets();
    const set = { id: foundry.utils.randomID(), name: name.slice(0, 60), items: [] };
    sets.push(set);
    if (await this.#saveSets(sets)) {
      this.#setId = set.id;
      this.#showSets = true;
      this.#rerender();
    }
  }

  async #deleteSet() {
    if (!this.#guard(false)) return;
    const sets = this.#sets();
    const set = sets.find(s => s.id === this.#setId);
    if (!set) return;
    const ok = await DialogV2.confirm({
      window: { title: i18n("LSC.DeleteSet") },
      content: `<p>${esc(game.i18n.format("LSC.DeleteConfirm", { name: set.name }))}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    if (await this.#saveSets(sets.filter(s => s.id !== set.id))) {
      this.#setId = null;
      this.#rerender();
    }
  }

  async #addToSet(src) {
    if (!this.#guard(false) || !src) return;
    const sets = this.#sets();
    const set = sets.find(s => s.id === this.#setId);
    if (!set || set.items.some(i => i.src === src)) return;
    set.items.push({ id: foundry.utils.randomID(), src });
    if (await this.#saveSets(sets)) this.#rerender();
  }

  #addImageToSet() {
    if (!this.#guard(false) || !this.#setId) return;
    this.#openPicker(path => this.#addToSet(path));
  }

  async #removeThumb(id) {
    if (!this.#guard(false)) return;
    const sets = this.#sets();
    const set = sets.find(s => s.id === this.#setId);
    if (!set) return;
    set.items = set.items.filter(i => i.id !== id);
    if (await this.#saveSets(sets)) this.#rerender();
  }

  #thumbPlace(src) {
    if (!src) return;
    this.#src = src;
    return this.#startPlacement(src);
  }

  /* ------------------------ colocação com prévia local ----------------------- */

  async #startPlacement(src) {
    if (!src || !this.#guard()) return;
    this.#cancelPlacement();
    const token = ++this.#token;
    const sceneId = canvas.scene.id;

    const size = await loadImageSize(src);
    let texture = null;
    if (size) {
      try { texture = await foundry.canvas.loadTexture(src); } catch (err) { texture = null; }
    }
    if (!size || !texture) return notify("LSC.Err.BadImage");
    if (token !== this.#token || canvas.scene?.id !== sceneId || !this.rendered) return;

    const { width, height } = initialSize(size.w, size.h);
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = width;
    sprite.height = height;
    sprite.alpha = 0.6;
    sprite.eventMode = "none";
    (canvas.interface ?? canvas.stage).addChild(sprite);

    const el = canvasEl();
    this.#placing = {
      src, width, height, sceneId, sprite, el,
      center: { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y },
      free: false
    };
    if (el) el.style.cursor = "crosshair";
    document.addEventListener("pointermove", this.#onMove, true);
    document.addEventListener("pointerdown", this.#onDown, true);
    document.addEventListener("keydown", this.#onKey, true);
    this.#updatePreview();
    this.#rerender();
  }

  #updatePreview() {
    const p = this.#placing;
    if (!p || p.sprite.destroyed) return;
    const tl = topLeftFor(p.center, p.width, p.height, p.free);
    p.sprite.position.set(tl.x + p.width / 2, tl.y + p.height / 2);
  }

  #onMove = ev => {
    const p = this.#placing;
    if (!p || ev.target !== p.el) return;
    p.center = clientToCanvas(ev.clientX, ev.clientY);
    p.free = ev.shiftKey;
    this.#updatePreview();
  };

  #onDown = ev => {
    const p = this.#placing;
    if (!p || ev.target !== p.el) return;
    if (ev.button === 2) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.#cancelPlacement();
      this.#rerender();
      return;
    }
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    if (this.#busy) return;
    if (canvas.scene?.id !== p.sceneId) {
      this.#cancelPlacement();
      this.#rerender();
      return notify("LSC.Err.SceneChanged");
    }
    const data = {
      src: p.src,
      center: clientToCanvas(ev.clientX, ev.clientY),
      free: ev.shiftKey
    };
    // Sem Ctrl/Cmd: encerra o modo ANTES de criar, para nunca haver duas criações por confirmação.
    if (!(ev.ctrlKey || ev.metaKey)) {
      this.#cancelPlacement();
      this.#rerender();
    }
    this.#createTile(data);
  };

  #onKey = ev => {
    if (ev.key !== "Escape" || !this.#placing) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    this.#cancelPlacement();
    this.#rerender();
  };

  /** Remove prévia e listeners temporários. Idempotente. */
  #cancelPlacement() {
    this.#token++;
    const p = this.#placing;
    if (!p) return;
    this.#placing = null;
    document.removeEventListener("pointermove", this.#onMove, true);
    document.removeEventListener("pointerdown", this.#onDown, true);
    document.removeEventListener("keydown", this.#onKey, true);
    if (p.el) p.el.style.cursor = "";
    if (p.sprite && !p.sprite.destroyed) {
      p.sprite.parent?.removeChild(p.sprite);
      p.sprite.destroy();
    }
  }

  async #onDrop(data, event) {
    if (!this.#guard()) return;
    this.#cancelPlacement();
    this.#rerender();
    await this.#createTile({ src: data.src, center: { x: data.x, y: data.y }, free: !!event?.shiftKey });
  }

  /* ------------------------------ criação do tile ---------------------------- */

  #nextSort(scene, key) {
    const base = LAYERS.find(l => l.key === key).base;
    const inBand = scene.tiles.filter(t => modFlags(t).layer === key && t.sort >= base && t.sort < base + BAND);
    return inBand.reduce((m, t) => Math.max(m, t.sort), base - 1) + 1;
  }

  #levelsData() {
    const out = {};
    const b = parseFloat(this.#bottom);
    const t = parseFloat(this.#top);
    if (Number.isFinite(b)) out.elevation = b;
    if (levelsActive()) {
      const lv = {};
      if (Number.isFinite(b)) lv.rangeBottom = b;
      if (Number.isFinite(t)) lv.rangeTop = t;
      if (Object.keys(lv).length) out.flags = { levels: lv };
    }
    return out;
  }

  async #createTile({ src, center, free }) {
    if (this.#busy || !this.#guard()) return;
    this.#busy = true;
    try {
      const scene = canvas.scene;
      const sceneId = scene.id;
      const size = await loadImageSize(src);
      if (!size) return notify("LSC.Err.BadImage");
      if (canvas.scene?.id !== sceneId) return notify("LSC.Err.SceneChanged");

      const { width, height } = initialSize(size.w, size.h);
      const tl = topLeftFor(center, width, height, free);
      const layer = this.#layer;
      const extra = this.#levelsData();
      const data = {
        x: Math.round(tl.x),
        y: Math.round(tl.y),
        width,
        height,
        rotation: 0,
        locked: false,
        hidden: false,
        texture: { src },
        sort: this.#nextSort(scene, layer),
        ...(extra.elevation !== undefined ? { elevation: extra.elevation } : {}),
        flags: { ...(extra.flags ?? {}), [MODULE_ID]: { layer, name: nameFromSrc(src) } }
      };
      const [doc] = await scene.createEmbeddedDocuments("Tile", [data]);
      if (doc) this.#activeId = doc.id;
      this.#rerender();
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      notify("LSC.Err.Failed", "error");
    } finally {
      this.#busy = false;
    }
  }

  /* ------------------------- seleção e edição mínima ------------------------- */

  #selectTile(id) {
    if (!this.#guard()) return;
    if (this.#activeId === id) {
      this.#activeId = null;
      return this.#rerender();
    }
    const doc = canvas.scene.tiles.get(id);
    if (!doc) {
      notify("LSC.Err.TileRemoved");
      return this.#rerender();
    }
    this.#activeId = id; // referência interna: funciona mesmo com a peça travada ou escondida
    if (!doc.locked && canvas.tiles?.active) {
      try { doc.object?.control({ releaseOthers: true }); } catch (err) { /* seleção no canvas é opcional */ }
    }
    this.#rerender();
  }

  /** Retorna a peça ativa se puder ser alterada (permissão, existência e travamento). */
  #editable() {
    if (!this.#guard()) return null;
    const doc = this.#activeDoc();
    if (!doc) { notify("LSC.Err.TileRemoved"); this.#activeId = null; this.#rerender(); return null; }
    if (doc.locked) { notify("LSC.Locked"); return null; }
    return doc;
  }

  async #update(doc, changes) {
    try {
      await doc.update(changes);
      return true;
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      notify("LSC.Err.Failed", "error");
      return false;
    }
  }

  async #scale(factor) {
    const doc = this.#editable();
    if (!doc) return;
    let w = doc.width * factor;
    let h = doc.height * factor;
    if (Math.min(w, h) < MIN_SIZE) return notify("LSC.Err.TooSmall");
    if (Math.max(w, h) > MAX_SIZE) return notify("LSC.Err.TooBig");
    const cx = doc.x + doc.width / 2;
    const cy = doc.y + doc.height / 2;
    w = Math.round(w);
    h = Math.round(h);
    await this.#update(doc, { width: w, height: h, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) });
  }

  async #rotate(delta) {
    const doc = this.#editable();
    if (!doc) return;
    await this.#update(doc, { rotation: (((doc.rotation + delta) % 360) + 360) % 360 });
  }

  async #toggleLock() {
    if (!this.#guard()) return;
    const doc = this.#activeDoc();
    if (!doc) { notify("LSC.Err.TileRemoved"); this.#activeId = null; return this.#rerender(); }
    await this.#update(doc, { locked: !doc.locked });
  }

  async #onLevels() {
    const el = this.element;
    this.#bottom = el.querySelector('input[name="bottom"]')?.value ?? "";
    const topInput = el.querySelector('input[name="top"]');
    if (topInput) this.#top = topInput.value;
    const doc = this.#activeDoc();
    if (!doc || !this.#guard() || doc.locked) return;
    const b = parseFloat(this.#bottom);
    const t = parseFloat(this.#top);
    const changes = {};
    if (Number.isFinite(b)) {
      changes.elevation = b;
      if (levelsActive()) changes["flags.levels.rangeBottom"] = b;
    }
    if (Number.isFinite(t) && levelsActive()) changes["flags.levels.rangeTop"] = t;
    if (Object.keys(changes).length) await this.#update(doc, changes);
  }
}
