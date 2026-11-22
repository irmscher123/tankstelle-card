/* tankstelle-card – https://github.com/irmscher123/tankstelle-card
 * Tankstellen Preismast / Fuel price pylon card for Home Assistant
 * DE: Spritpreise im Look einer Tankstellen-Preissäule, responsiv, Deutsch & Englisch
 * EN: Fuel prices styled like a petrol station price pylon, responsive, German & English
 */

const LitElement = Object.getPrototypeOf(
  customElements.get("ha-panel-lovelace") || customElements.get("hui-view")
);
const { html, css } = LitElement.prototype;

const CARD_VERSION = "2.2.1";
// Logos liegen im Repo (Ordner /logos) und kommen über das jsDelivr-CDN.
// Eigene Quelle möglich über die Option logo_base (z.B. "/local/tankstelle/logos/").
const LEGACY_LOGO_BASE = "https://www.irmscher.at/homeassistant/logos/";
const LOGO_BASE = "https://cdn.jsdelivr.net/gh/irmscher123/tankstelle-card@main/logos/";

// Schriftart global laden (@font-face funktioniert im Shadow DOM nicht)
const FONT_URL = "/local/fonts/triple_dot_digital-7.ttf";
if (!document.getElementById("tankstelle-card-font")) {
  const style = document.createElement("style");
  style.id = "tankstelle-card-font";
  style.textContent = `
    @font-face {
      font-family: "TripleDotDigital7";
      src: url("${FONT_URL}") format("truetype");
      font-display: swap;
    }`;
  document.head.appendChild(style);
}

// [Regex, Anzeigename, Logo] – Reihenfolge = Priorität
const BRANDS = [
  [/avanti/, "AVANTI", "avanti.png"],
  [/\bbp\b/, "BP", "bp.png"],
  [/diskont/, "Diskont", "diskont.png"],
  [/\beni\b/, "ENI", "eni.png"],
  [/\bjet\b/, "JET", "jet.png"],
  [/lagerhaus/, "Lagerhaus", "default.png"],
  [/pink/, "Pink", "pink.png"],
  [/\bomv\b/, "OMV", "omv.png"],
  [/shell/, "Shell", "shell.png"],
  [/socar/, "SOCAR", "socar.png"],
  [/turm(ö|oe)l/, "Turmöl", "turmoel.png"],
  [/\biq\b/, "IQ", "iq.png"],
  [/genol/, "Genol", "genol.png"],
  [/\bavia\b/, "AVIA", "avia.png"],
  [/\bmol\b/, "MOL", "mol.png"],
  [/\besso\b/, "Esso", "esso.png"],
];

const DEFAULTS = {
  base_entity: "sensor.leonding",
  fuel_type: "diesel",
  count: 5,
  location_name: "Leonding",
  title_override: "",
  // Darstellung
  card_color: "#1c1c1c",
  accent_color: "",            // leer = automatisch (Diesel gelb, Super grün)
  led_color: "#00ff00",
  price_box_min_width: 104,
  price_font_size: 22,
  decimal_separator: ".",
  superscript_digit: true,     // letzte Kommastelle hochgestellt wie an der Säule
  ghost_digits: true,          // "ausgeschaltete" LED-Segmente im Hintergrund
  show_header: true,
  show_logos: true,
  logo_base: "",               // leer = Logos aus dem GitHub-Repo
  show_rank: false,
  show_base: true,             // Standfuß der Säule
  show_updated: true,
  // Funktionen
  highlight_cheapest: true,
  show_diff: true,
  show_distance: true,
  show_navigation: true,
  nav_provider: "google",
  trend_minutes: 60,
  // Animation
  animate_changes: true,
  up_color: "rgba(255, 60, 60, 0.35)",
  down_color: "rgba(0, 255, 0, 0.30)",
  pulse_scale: 1.045,
  glow_strength: 1.0,
};

const FUEL = {
  diesel: { title: "Diesel", accent: "#f2b705", icon: "mdi:gas-station", start: 1 },
  super: { title: "Super 95", accent: "#1fa34a", icon: "mdi:gas-station-outline", start: 6 },
};

const NAV_URL = {
  google: (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`,
  apple: (lat, lon) => `https://maps.apple.com/?daddr=${lat},${lon}`,
  waze: (lat, lon) => `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`,
};

// --- Übersetzungen / Translations ---
const I18N = {
  de: {
    best: "Bestpreis",
    updated: "Stand",
    route: "Route starten",
    routeTo: "Route zu",
    currency: "Euro",
    noData: "Keine Daten. Prüfe die Entity-Namen, z.B.",
  },
  en: {
    best: "Best price",
    updated: "Updated",
    route: "Start route",
    routeTo: "Route to",
    currency: "euros",
    noData: "No data. Check the entity names, e.g.",
  },
};
const langOf = (hass) => (String(hass?.locale?.language || hass?.language || "de").startsWith("de") ? "de" : "en");

class TankstelleCard extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      config: { state: true },
      _tick: { state: true },
    };
  }

  static getConfigElement() {
    return document.createElement("tankstelle-card-editor");
  }

  static getStubConfig() {
    const { base_entity, fuel_type, count, location_name } = DEFAULTS;
    return { base_entity, fuel_type, count, location_name };
  }

  constructor() {
    super();
    this._prevPrices = {};  // letzter Preis pro Entity
    this._pendingAnim = {}; // Richtung, die nach dem Render animiert wird
    this._trend = {};       // { id: { dir, at } } für Trendpfeile
    this._brandCache = new Map();
  }

  setConfig(config) {
    if (!config.base_entity) throw new Error("Bitte base_entity angeben, z.B. sensor.leonding");
    this.config = { ...DEFAULTS, ...config };
    this._prevPrices = {};
    this._brandCache.clear();
  }

  connectedCallback() {
    super.connectedCallback();
    // einmal pro Minute: "Stand"-Zeit und Trendpfeile aktualisieren
    this._timer = setInterval(() => (this._tick = Date.now()), 60000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._timer);
  }

  getCardSize() {
    const c = this.config || DEFAULTS;
    return (c.show_header !== false ? 2 : 0) + (Number(c.count) || 5) + (c.show_base !== false ? 1 : 0);
  }

  // Sections-Dashboard
  getGridOptions() {
    return { columns: 6, min_columns: 3 };
  }

  // --- Entity-IDs, die diese Karte betreffen ---
  get _t() {
    return I18N[langOf(this.hass)];
  }

  get _fuel() {
    return FUEL[this.config.fuel_type] || FUEL.diesel;
  }

  get _entityIds() {
    const count = Math.min(Math.max(Number(this.config.count) || 5, 1), 5);
    const start = this._fuel.start;
    return Array.from({ length: count }, (_, i) => `${this.config.base_entity}_${start + i}`);
  }

  shouldUpdate(changed) {
    if (changed.has("config") || changed.has("_tick")) return true;
    const oldHass = changed.get("hass");
    if (!oldHass) return true;
    return this._entityIds.some((id) => oldHass.states[id] !== this.hass.states[id]);
  }

  willUpdate() {
    if (!this.hass || !this.config) return;
    const animate = this.config.animate_changes !== false;
    for (const id of this._entityIds) {
      const num = Number(this.hass.states[id]?.state);
      if (!Number.isFinite(num)) continue;
      const prev = this._prevPrices[id];
      if (prev !== undefined && prev !== num) {
        const dir = num > prev ? "up" : "down";
        this._trend[id] = { dir, at: Date.now() };
        if (animate) this._pendingAnim[id] = dir;
      }
      this._prevPrices[id] = num;
    }
  }

  updated() {
    for (const [id, dir] of Object.entries(this._pendingAnim)) this._triggerAnimation(id, dir);
    this._pendingAnim = {};
  }

  // --- LOGIK ---
  get _logoBase() {
    const b = String(this.config.logo_base || "").trim();
    return b ? (b.endsWith("/") ? b : b + "/") : LOGO_BASE;
  }

  // Fallback-Kette: Logo -> default.png -> Logo vom alten Server -> ausblenden
  _logoError(e) {
    const img = e.target;
    const file = img.src.split("/").pop();
    const step = Number(img.dataset.fb || 0);
    img.dataset.fb = step + 1;
    if (step === 0 && file !== "default.png") img.src = this._logoBase + "default.png";
    else if (step <= 1) img.src = LEGACY_LOGO_BASE + (img.dataset.file || file);
    else img.style.visibility = "hidden";
  }

  _brand(entity) {
    const raw = entity.attributes.name || "";
    if (this._brandCache.has(raw)) return this._brandCache.get(raw);

    const n = raw.toLowerCase();
    const hit = BRANDS.find(([re]) => re.test(n));
    const loc = this.config.location_name;
    const fallbackName =
      (loc ? raw.split(new RegExp(`\\s*-?\\s*${loc}`, "i"))[0] : raw).trim() || "Tankstelle";

    const result = {
      name: hit ? hit[1] : fallbackName,
      logo: this._logoBase + (hit ? hit[2] : "default.png"),
    };
    this._brandCache.set(raw, result);
    return result;
  }

  _address(entity) {
    const txt = entity.attributes.location?.address || entity.attributes.name || "";
    const loc = this.config.location_name;
    return (loc ? txt.replace(new RegExp(loc, "gi"), "") : txt)
      .replace(/\b\d{4}\b/g, "")
      .replace(/_/g, " ")
      .replace(/(s)trasse\b/gi, "$1traße")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s,]+|[\s,]+$/g, "");
  }

  _title() {
    const t = String(this.config.title_override ?? "").trim();
    return t || this._fuel.title;
  }

  _splitPrice(num) {
    const sep = this.config.decimal_separator || ".";
    const s = num.toFixed(3).replace(".", sep);
    if (this.config.superscript_digit === false) return [s, ""];
    return [s.slice(0, -1), s.slice(-1)];
  }

  _distance(entity) {
    const loc = entity.attributes.location;
    const home = this.hass.config || {};
    if (!loc?.latitude || !loc?.longitude || home.latitude == null) return null;
    const R = 6371;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(loc.latitude - home.latitude);
    const dLon = rad(loc.longitude - home.longitude);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(home.latitude)) * Math.cos(rad(loc.latitude)) * Math.sin(dLon / 2) ** 2;
    const km = 2 * R * Math.asin(Math.sqrt(a));
    return km < 1
      ? `${Math.round((km * 1000) / 50) * 50} m`
      : `${km.toFixed(1).replace(".", ",")} km`;
  }

  _trendFor(id) {
    const t = this._trend[id];
    const mins = Number(this.config.trend_minutes);
    if (!t || !(mins > 0)) return null;
    return Date.now() - t.at < mins * 60000 ? t.dir : null;
  }

  _updatedText(entities) {
    const ts = entities
      .map((e) => Date.parse(e.last_updated || e.last_changed))
      .filter(Number.isFinite);
    if (!ts.length) return "";
    const d = new Date(Math.max(...ts));
    const lang = this.hass.locale?.language || "de-AT";
    const time = d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? `${this._t.updated} ${time}`
      : `${this._t.updated} ${d.toLocaleDateString(lang, { day: "2-digit", month: "2-digit" })} ${time}`;
  }

  _moreInfo(entityId) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })
    );
  }

  _navigate(e, loc) {
    e.stopPropagation();
    const build = NAV_URL[this.config.nav_provider] || NAV_URL.google;
    window.open(build(loc.latitude, loc.longitude), "_blank", "noopener");
  }

  _triggerAnimation(entityId, direction) {
    const el = this.renderRoot?.querySelector(`.price[data-entity="${entityId}"]`);
    if (!el) return;
    el.classList.remove("price-changed", "price-up", "price-down");
    void el.offsetWidth; // Reflow -> Animation startet neu
    el.classList.add("price-changed", direction === "up" ? "price-up" : "price-down");
    el.addEventListener(
      "animationend",
      () => el.classList.remove("price-changed", "price-up", "price-down"),
      { once: true }
    );
  }

  _led(text, cls = "") {
    return html`<span class="led ${cls}">
      ${this.config.ghost_digits !== false
        ? html`<span class="ghost" aria-hidden="true">${text.replace(/\d/g, "8")}</span>`
        : ""}
      <span class="lit">${text}</span>
    </span>`;
  }

  _row({ id, entity, num }, minPrice, rank) {
    const c = this.config;
    const { name, logo } = this._brand(entity);
    const [main, sup] = this._splitPrice(num);
    const isBest = c.highlight_cheapest !== false && Math.abs(num - minPrice) < 0.0005;
    const diffCt = (num - minPrice) * 100;
    const loc = entity.attributes.location;
    const canNav = c.show_navigation !== false && loc?.latitude && loc?.longitude;
    const trend = this._trendFor(id);
    const address = this._address(entity);

    const meta = [];
    if (c.show_distance !== false) {
      const dist = this._distance(entity);
      if (dist) meta.push(html`<span>${dist}</span>`);
    }
    if (c.show_diff !== false && !isBest && diffCt >= 0.05) {
      meta.push(html`<span class="diff">+${diffCt.toFixed(1).replace(".", ",")} ct</span>`);
    }

    const t = this._t;
    const label = `${name}, ${address}: ${num.toFixed(3)} ${t.currency}${isBest ? `, ${t.best}` : ""}`;

    return html`
      <div class="panel ${isBest ? "best" : ""}" role="button" tabindex="0" aria-label=${label}
           @click=${() => this._moreInfo(id)}
           @keydown=${(e) => {
             if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._moreInfo(id); }
           }}>
        ${c.show_logos !== false
          ? html`<div class="logo">
              <img src=${logo} data-file=${logo.split("/").pop()} alt="" loading="lazy" decoding="async"
                   @error=${(e) => this._logoError(e)} />
              ${c.show_rank ? html`<span class="rank">${rank}</span>` : ""}
            </div>`
          : ""}
        <div class="info">
          <div class="name">
            <span class="name-text">${name}</span>
            ${isBest ? html`<span class="tag">${t.best}</span>` : ""}
          </div>
          ${address || meta.length
            ? html`<div class="sub">
                ${address ? html`<span class="addr">${address}</span>` : ""}
                ${meta.length ? html`<span class="meta">${meta}</span>` : ""}
              </div>`
            : ""}
        </div>
        <div class="price" data-entity=${id}>
          ${trend
            ? html`<span class="trend ${trend}" aria-hidden="true">${trend === "up" ? "▲" : "▼"}</span>`
            : ""}
          <span class="digits">
            ${this._led(main)}
            ${sup ? this._led(sup, "sup") : ""}
          </span>
        </div>
        ${canNav
          ? html`<button class="nav" title=${t.route} aria-label=${`${t.routeTo} ${name}`}
                    @click=${(e) => this._navigate(e, loc)}
                    @keydown=${(e) => e.stopPropagation()}>
              <ha-icon icon="mdi:navigation-variant"></ha-icon>
            </button>`
          : ""}
      </div>
    `;
  }

  render() {
    if (!this.hass || !this.config) return html``;
    const c = this.config;

    const data = this._entityIds
      .map((id) => ({ id, entity: this.hass.states[id] }))
      .filter((d) => d.entity)
      .map((d) => ({ ...d, num: Number(d.entity.state) }))
      .filter((d) => Number.isFinite(d.num));

    if (data.length === 0) {
      return html`<ha-card class="error">
        <ha-icon icon="mdi:gas-station-off"></ha-icon>
        <div>${this._t.noData} <code>${c.base_entity}_${this._fuel.start}</code></div>
      </ha-card>`;
    }

    const minPrice = Math.min(...data.map((d) => d.num));
    const showLogos = c.show_logos !== false;
    const showNav = c.show_navigation !== false;
    const minW = Number(c.price_box_min_width);

    const colsWide = [showLogos && "auto", "minmax(0,1fr)", "auto", showNav && "auto"].filter(Boolean).join(" ");
    const colsNarrow = [showLogos && "auto", "minmax(0,1fr)", showNav && "auto"].filter(Boolean).join(" ");

    const style = [
      `--mast: ${c.card_color || DEFAULTS.card_color}`,
      `--accent: ${c.accent_color || this._fuel.accent}`,
      `--led: ${c.led_color || DEFAULTS.led_color}`,
      `--price-min-width: ${Number.isFinite(minW) ? minW : DEFAULTS.price_box_min_width}px`,
      `--price-font-size: ${Number(c.price_font_size) || DEFAULTS.price_font_size}px`,
      `--glow-up: ${c.up_color || DEFAULTS.up_color}`,
      `--glow-down: ${c.down_color || DEFAULTS.down_color}`,
      `--pulse-scale: ${Number(c.pulse_scale) || DEFAULTS.pulse_scale}`,
      `--glow-strength: ${Number(c.glow_strength) || DEFAULTS.glow_strength}`,
      `--cols-wide: ${colsWide}`,
      `--cols-narrow: ${colsNarrow}`,
    ].join(";");

    const updated = c.show_updated !== false ? this._updatedText(data.map((d) => d.entity)) : "";

    return html`
      <ha-card style=${style}>
        <div class="pylon">
          <div class="mast">
            ${c.show_header !== false
              ? html`<div class="crown">
                  <div class="crown-light"></div>
                  <ha-icon class="crown-icon" icon=${this._fuel.icon}></ha-icon>
                  <div class="crown-text">
                    <div class="crown-title">${this._title()}</div>
                    ${c.location_name ? html`<div class="crown-sub">${c.location_name}</div>` : ""}
                  </div>
                </div>`
              : ""}
            <div class="panels">
              ${data.map((d, i) => this._row(d, minPrice, i + 1))}
            </div>
            ${updated
              ? html`<div class="foot"><ha-icon icon="mdi:clock-outline"></ha-icon>${updated}</div>`
              : ""}
          </div>
          ${c.show_base !== false
            ? html`<div class="base" aria-hidden="true">
                <span class="leg"></span><span class="leg"></span>
                <span class="plinth"></span>
              </div>`
            : ""}
        </div>
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      :host { display: block; height: 100%; }

      ha-card {
        background: none;
        border: none;
        box-shadow: none;
        border-radius: 0;
        overflow: visible;
        height: 100%;
        container-type: inline-size;
        color: #fff;
        -webkit-tap-highlight-color: transparent;
      }
      ha-card.error {
        display: flex; gap: 12px; align-items: center;
        padding: 16px; color: var(--error-color, #db4437);
        background: var(--ha-card-background, var(--card-background-color));
        border-radius: var(--ha-card-border-radius, 12px);
      }

      .pylon { display: flex; flex-direction: column; height: 100%; }

      /* ---------- Mast ---------- */
      .mast {
        position: relative;
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 6px;
        border-radius: 14px 14px 6px 6px;
        background:
          linear-gradient(90deg,
            rgba(255,255,255,.07) 0, transparent 3%, transparent 97%, rgba(255,255,255,.07) 100%),
          var(--mast);
        border: 1px solid rgba(255,255,255,.08);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 6px 18px rgba(0,0,0,.35);
        z-index: 1;
      }

      /* ---------- Krone ---------- */
      .crown {
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 40px;
        padding: 5px 12px;
        border-radius: 9px 9px 4px 4px;
        background: linear-gradient(180deg, rgba(255,255,255,.28), rgba(255,255,255,0) 55%), var(--accent);
        color: #111;
        box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 30%, transparent);
      }
      .crown-light { display: none; }
      .crown-icon { --mdc-icon-size: 22px; position: relative; }
      .crown-text { position: relative; text-align: left; min-width: 0; }
      .crown-title {
        font-size: clamp(15px, 4.4cqi, 19px);
        font-weight: 900;
        letter-spacing: .08em;
        text-transform: uppercase;
        line-height: 1;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .crown-sub {
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: .16em;
        text-transform: uppercase;
        opacity: .65;
        margin-top: 2px;
      }

      /* ---------- Preistafeln ---------- */
      .panels { display: flex; flex-direction: column; gap: 4px; flex-grow: 1; }

      .panel {
        position: relative;
        display: grid;
        grid-template-columns: var(--cols-wide);
        align-items: center;
        column-gap: 10px;
        row-gap: 4px;
        min-height: 50px;
        padding: 5px 8px 5px 10px;
        border-radius: 7px;
        background: #0e0e0e;
        border: 1px solid rgba(255,255,255,.05);
        cursor: pointer;
        outline: none;
        transition: background .2s, transform .12s;
      }
      .panel:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
      .panel:active { transform: scale(.99); }
      @media (hover: hover) { .panel:hover { background: #151515; } }
      .panel.best {
        background: linear-gradient(90deg, color-mix(in srgb, var(--led) 9%, #0e0e0e), #0e0e0e 60%);
      }
      .panel.best::before {
        content: "";
        position: absolute; left: 0; top: 7px; bottom: 7px;
        width: 3px; border-radius: 0 3px 3px 0;
        background: var(--led);
        box-shadow: 0 0 6px var(--led);
      }

      .logo { position: relative; width: 32px; height: 32px; }
      .logo img { width: 100%; height: 100%; object-fit: contain; border-radius: 5px; }
      .rank {
        position: absolute; top: -5px; left: -5px;
        min-width: 15px; height: 15px; border-radius: 8px;
        background: #2a2a2a; border: 1px solid rgba(255,255,255,.18);
        font-size: 9.5px; font-weight: 800; line-height: 13px; text-align: center; color: #ddd;
      }
      .panel.best .rank { background: var(--led); color: #000; border-color: transparent; }

      .info { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      .name { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .name-text {
        font-size: 14.5px; font-weight: 700; line-height: 1.2;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .tag {
        flex-shrink: 0;
        font-size: 8.5px; font-weight: 800;
        letter-spacing: .08em; text-transform: uppercase;
        padding: 1px 5px; border-radius: 4px;
        color: var(--led);
        border: 1px solid color-mix(in srgb, var(--led) 50%, transparent);
      }
      .sub {
        display: flex; gap: 6px; min-width: 0;
        font-size: 11.5px; color: #8f8f8f; line-height: 1.3;
      }
      .addr { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .meta { flex-shrink: 0; display: inline-flex; gap: 6px; }
      .meta > span::before { content: "·"; margin-right: 6px; color: #555; }
      .sub > .meta:first-child > span:first-child::before { content: none; }
      .meta .diff { color: #e38a7d; }

      /* ---------- LED-Preisanzeige ---------- */
      .price {
        position: relative;
        display: flex; align-items: center; justify-content: center;
        min-width: min(var(--price-min-width), 34cqi);
        box-sizing: border-box;
        /* die LED-Schrift zeichnet über ihre eigenen Maße hinaus -> großzügiger Rand */
        padding: 0.22em 0.55em 0.18em 0.45em;
        font-size: min(var(--price-font-size), 8cqi);
        border-radius: 5px;
        background: #000;
        border: 1px solid #262626;
        box-shadow: inset 0 0 8px color-mix(in srgb, var(--led) 8%, transparent);
      }
      .digits { display: inline-flex; align-items: flex-start; gap: 0.08em; }
      .led {
        display: inline-grid;
        font-family: "TripleDotDigital7", "Repet", ui-monospace, monospace;
        font-size: min(var(--price-font-size), 8cqi);
        line-height: 1.15;
        font-variant-numeric: tabular-nums;
      }
      .led > span { grid-area: 1 / 1; white-space: pre; }
      .led .ghost { color: var(--led); opacity: .06; }
      .led .lit {
        color: var(--led);
        text-shadow: 0 0 4px color-mix(in srgb, var(--led) 55%, transparent);
      }
      .led.sup { font-size: calc(min(var(--price-font-size), 8cqi) * .6); line-height: 1.1; }

      .trend { position: absolute; top: 2px; left: 4px; font-size: 8px; line-height: 1; }
      .trend.up { color: #ff5a4a; }
      .trend.down { color: var(--led); }

      .nav {
        display: grid; place-items: center;
        width: 32px; height: 32px;
        border-radius: 50%;
        border: none;
        background: rgba(255,255,255,.06);
        color: #cfcfcf;
        cursor: pointer;
        padding: 0;
        transition: background .2s, color .2s;
      }
      .nav ha-icon { --mdc-icon-size: 17px; }
      .nav:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      @media (hover: hover) { .nav:hover { background: rgba(255,255,255,.14); color: #fff; } }
      /* größere Tippfläche ohne größeren Kreis */
      .nav { position: relative; }
      .nav::after { content: ""; position: absolute; inset: -6px; }

      .foot {
        display: flex; align-items: center; justify-content: center; gap: 4px;
        font-size: 10.5px; color: #777; padding-bottom: 1px;
      }
      .foot ha-icon { --mdc-icon-size: 12px; }

      /* ---------- Standfuß ---------- */
      .base {
        position: relative;
        display: flex; justify-content: center; gap: 40%;
        height: 16px;
        margin-top: -1px;
      }
      .leg {
        width: clamp(10px, 4cqi, 18px);
        height: 12px;
        background: linear-gradient(90deg, #262626, #3d3d3d 40%, #222);
      }
      .plinth {
        position: absolute; bottom: 0; left: 22%; right: 22%;
        height: 5px; border-radius: 2px;
        background: linear-gradient(180deg, #3d3d3d, #1e1e1e);
        box-shadow: 0 4px 8px rgba(0,0,0,.35);
      }

      /* ---------- Responsiv (Breite der Karte) ---------- */
      /* Handy: Zusatzinfos weglassen, damit Name und Adresse lesbar bleiben */
      @container (max-width: 400px) {
        .meta, .tag { display: none; }
      }
      @container (max-width: 300px) {
        .panel { grid-template-columns: var(--cols-narrow); }
        .price { grid-column: 1 / -1; grid-row: 2; justify-self: end; min-width: 0; font-size: min(var(--price-font-size), 11cqi); }
        .led { font-size: min(var(--price-font-size), 11cqi); }
        .led.sup { font-size: calc(min(var(--price-font-size), 11cqi) * .6); }
        .meta { display: none; }
      }
      @container (max-width: 240px) {
        .logo, .sub, .crown-icon, .crown-sub, .tag { display: none; }
        .panel { grid-template-columns: minmax(0,1fr) auto; }
        .panel .price { grid-row: auto; grid-column: auto; }
        .nav { display: none; }
      }
      @container (min-width: 560px) {
        .panel { min-height: 58px; }
        .name-text { font-size: 16px; }
        .sub { font-size: 12.5px; }
        .logo { width: 38px; height: 38px; }
      }

      /* Animation */
      @keyframes pricePulse {
        0% { transform: scale(1); }
        30% { transform: scale(var(--pulse-scale, 1.045)); }
        100% { transform: scale(1); }
      }
      @keyframes glowPulse {
        0%, 100% { box-shadow: inset 0 0 8px rgba(0,255,0,.08), 0 0 0 transparent; }
        35% {
          box-shadow:
            inset 0 0 calc(14px * var(--glow-strength, 1)) rgba(0,255,0,.12),
            0 0 calc(14px * var(--glow-strength, 1)) var(--glow-color);
        }
      }
      .price.price-up { --glow-color: var(--glow-up); }
      .price.price-down { --glow-color: var(--glow-down); }
      .price.price-changed { animation: pricePulse 420ms ease-out, glowPulse 720ms ease-out; }

      @media (prefers-reduced-motion: reduce) {
        .price.price-changed { animation: glowPulse 720ms ease-out; }
        .panel, .panel:active { transition: none; transform: none; }
      }
    `;
  }
}

/* --- EDITOR (UI) --- */
const buildSchema = (L) => [
  { name: "base_entity", selector: { text: {} } },
  {
    type: "grid",
    name: "",
    schema: [
      {
        name: "fuel_type",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "diesel", label: L.opt_diesel },
              { value: "super", label: L.opt_super },
            ],
          },
        },
      },
      { name: "count", selector: { number: { min: 1, max: 5, mode: "box" } } },
    ],
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "location_name", selector: { text: {} } },
      { name: "title_override", selector: { text: {} } },
    ],
  },
  {
    type: "expandable",
    name: "",
    title: L.sec_look,
    schema: [
      {
        type: "grid",
        name: "",
        schema: [
          { name: "card_color", selector: { text: {} } },
          { name: "accent_color", selector: { text: {} } },
          { name: "led_color", selector: { text: {} } },
          { name: "logo_base", selector: { text: {} } },
          {
            name: "decimal_separator",
            selector: { select: { mode: "dropdown", options: [{ value: ".", label: L.opt_dot }, { value: ",", label: L.opt_comma }] } },
          },
          { name: "price_box_min_width", selector: { number: { min: 60, max: 300, mode: "box", unit_of_measurement: "px" } } },
          { name: "price_font_size", selector: { number: { min: 16, max: 60, mode: "box", unit_of_measurement: "px" } } },
        ],
      },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "show_header", selector: { boolean: {} } },
          { name: "show_logos", selector: { boolean: {} } },
          { name: "show_rank", selector: { boolean: {} } },
          { name: "show_base", selector: { boolean: {} } },
          { name: "show_updated", selector: { boolean: {} } },
          { name: "superscript_digit", selector: { boolean: {} } },
          { name: "ghost_digits", selector: { boolean: {} } },
        ],
      },
    ],
  },
  {
    type: "expandable",
    name: "",
    title: L.sec_features,
    schema: [
      {
        type: "grid",
        name: "",
        schema: [
          { name: "highlight_cheapest", selector: { boolean: {} } },
          { name: "show_diff", selector: { boolean: {} } },
          { name: "show_distance", selector: { boolean: {} } },
          { name: "show_navigation", selector: { boolean: {} } },
        ],
      },
      {
        type: "grid",
        name: "",
        schema: [
          {
            name: "nav_provider",
            selector: {
              select: {
                mode: "dropdown",
                options: [
                  { value: "google", label: "Google Maps" },
                  { value: "apple", label: L.opt_apple },
                  { value: "waze", label: "Waze" },
                ],
              },
            },
          },
          { name: "trend_minutes", selector: { number: { min: 0, max: 1440, mode: "box", unit_of_measurement: "min" } } },
        ],
      },
    ],
  },
  {
    type: "expandable",
    name: "",
    title: L.sec_anim,
    schema: [
      { name: "animate_changes", selector: { boolean: {} } },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "up_color", selector: { text: {} } },
          { name: "down_color", selector: { text: {} } },
          { name: "pulse_scale", selector: { number: { min: 1, max: 1.3, step: 0.005, mode: "box" } } },
          { name: "glow_strength", selector: { number: { min: 0, max: 3, step: 0.1, mode: "box" } } },
        ],
      },
    ],
  },
];

const LABELS = {
  de: {
    base_entity: "Basis-Entity (z.B. sensor.leonding)",
    fuel_type: "Spritart",
    count: "Anzahl Tankstellen",
    location_name: "Ortsname (Untertitel, wird aus Adresse entfernt)",
    title_override: "Titel (leer = Standard)",
    card_color: "Mastfarbe (z.B. #1c1c1c)",
    accent_color: "Akzentfarbe Krone (leer = automatisch)",
    led_color: "LED-Farbe",
    logo_base: "Logo-Pfad (leer = aus GitHub-Repo)",
    decimal_separator: "Dezimaltrenner",
    price_box_min_width: "Min. Breite Preisbox",
    price_font_size: "Schriftgröße Preis",
    show_header: "Krone (Titel) anzeigen",
    show_logos: "Logos anzeigen",
    show_rank: "Platznummer anzeigen",
    show_base: "Standfuß anzeigen",
    show_updated: "Aktualisierungszeit anzeigen",
    superscript_digit: "Letzte Stelle hochgestellt",
    ghost_digits: "LED-Hintergrundsegmente",
    highlight_cheapest: "Bestpreis hervorheben",
    show_diff: "Differenz zum Bestpreis (ct)",
    show_distance: "Entfernung von Zuhause",
    show_navigation: "Navigations-Button",
    nav_provider: "Navigations-App",
    trend_minutes: "Trendpfeil anzeigen für",
    animate_changes: "Animation bei Preisänderung",
    up_color: "Farbe: Preis steigt",
    down_color: "Farbe: Preis fällt",
    pulse_scale: "Puls-Stärke",
    glow_strength: "Glow-Stärke",
    sec_look: "Darstellung",
    sec_features: "Funktionen",
    sec_anim: "Animation",
    opt_diesel: "Diesel (Sensoren 1–5)",
    opt_super: "Super (Sensoren 6–10)",
    opt_dot: "Punkt (1.94⁹)",
    opt_comma: "Komma (1,94⁹)",
    opt_apple: "Apple Karten",
  },
  en: {
    base_entity: "Base entity (e.g. sensor.leonding)",
    fuel_type: "Fuel type",
    count: "Number of stations",
    location_name: "Location name (subtitle, removed from address)",
    title_override: "Title (empty = default)",
    card_color: "Pylon colour (e.g. #1c1c1c)",
    accent_color: "Crown accent colour (empty = automatic)",
    led_color: "LED colour",
    logo_base: "Logo path (empty = from GitHub repo)",
    decimal_separator: "Decimal separator",
    price_box_min_width: "Min. width of price box",
    price_font_size: "Price font size",
    show_header: "Show crown (title)",
    show_logos: "Show logos",
    show_rank: "Show rank number",
    show_base: "Show pylon base",
    show_updated: "Show update time",
    superscript_digit: "Last digit superscript",
    ghost_digits: "LED background segments",
    highlight_cheapest: "Highlight best price",
    show_diff: "Difference to best price (ct)",
    show_distance: "Distance from home",
    show_navigation: "Navigation button",
    nav_provider: "Navigation app",
    trend_minutes: "Show trend arrow for",
    animate_changes: "Animate price changes",
    up_color: "Colour: price rising",
    down_color: "Colour: price falling",
    pulse_scale: "Pulse strength",
    glow_strength: "Glow strength",
    sec_look: "Appearance",
    sec_features: "Features",
    sec_anim: "Animation",
    opt_diesel: "Diesel (sensors 1–5)",
    opt_super: "Petrol / Super (sensors 6–10)",
    opt_dot: "Dot (1.94⁹)",
    opt_comma: "Comma (1,94⁹)",
    opt_apple: "Apple Maps",
  },
};

class TankstelleCardEditor extends LitElement {
  static get properties() {
    return { hass: { attribute: false }, _config: { state: true } };
  }

  setConfig(config) {
    this._config = { ...DEFAULTS, ...config };
  }

  _valueChanged(ev) {
    ev.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: ev.detail.value },
        bubbles: true,
        composed: true,
      })
    );
  }

  render() {
    if (!this.hass || !this._config) return html``;
    const L = LABELS[langOf(this.hass)];
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${buildSchema(L)}
        .computeLabel=${(s) => L[s.name] ?? s.name}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `;
  }
}

if (!customElements.get("tankstelle-card-editor")) customElements.define("tankstelle-card-editor", TankstelleCardEditor);
if (!customElements.get("tankstelle-card")) customElements.define("tankstelle-card", TankstelleCard);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "tankstelle-card")) {
  window.customCards.push({
    type: "tankstelle-card",
    name: "Tankstellen Preismast / Fuel Price Pylon",
    preview: true,
    description: "Spritpreise im Look einer Preissäule / Fuel prices styled like a petrol station price pylon.",
  });
}

console.info(`%c TANKSTELLE-CARD %c v${CARD_VERSION} `, "background:#f2b705;color:#000;font-weight:700", "background:#111;color:#0f0");
