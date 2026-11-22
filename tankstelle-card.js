/* tankstelle-card – https://github.com/irmscher123/tankstelle-card
 * Tankstellen-Karte v2 – "Preismast"
 * - Look einer echten Tankstellen-Preissäule (Krone, Mast, LED-Preistafeln, Standfuß)
 * - Responsiv über Container-Queries (Handy, Tablet, Wandpanel, Sections-Grid)
 * - Bestpreis-Markierung, Differenz in Cent, Entfernung, Navigation, Trendpfeile
 */

const LitElement = Object.getPrototypeOf(
  customElements.get("ha-panel-lovelace") || customElements.get("hui-view")
);
const { html, css } = LitElement.prototype;

const CARD_VERSION = "2.0.0";
const LOGO_BASE = "https://www.irmscher.at/homeassistant/logos/";

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
  price_box_min_width: 130,
  price_font_size: 26,
  decimal_separator: ".",
  superscript_digit: true,     // letzte Kommastelle hochgestellt wie an der Säule
  ghost_digits: true,          // "ausgeschaltete" LED-Segmente im Hintergrund
  show_header: true,
  show_logos: true,
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
    return { ...DEFAULTS };
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
      logo: LOGO_BASE + (hit ? hit[2] : "default.png"),
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
      ? `Stand ${time}`
      : `Stand ${d.toLocaleDateString(lang, { day: "2-digit", month: "2-digit" })} ${time}`;
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

    const chips = [];
    if (c.show_distance !== false) {
      const dist = this._distance(entity);
      if (dist) chips.push(html`<span class="chip"><ha-icon icon="mdi:map-marker-distance"></ha-icon>${dist}</span>`);
    }
    if (c.show_diff !== false && !isBest && diffCt >= 0.05) {
      chips.push(html`<span class="chip diff">+${diffCt.toFixed(1).replace(".", ",")} ct</span>`);
    }

    const label = `${name}, ${address}: ${num.toFixed(3).replace(".", ",")} Euro${isBest ? ", Bestpreis" : ""}`;

    return html`
      <div class="panel ${isBest ? "best" : ""}" role="button" tabindex="0" aria-label=${label}
           @click=${() => this._moreInfo(id)}
           @keydown=${(e) => {
             if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._moreInfo(id); }
           }}>
        ${c.show_logos !== false
          ? html`<div class="logo">
              <img src=${logo} alt="" loading="lazy" decoding="async"
                   @error=${(e) => {
                     if (!e.target.src.endsWith("default.png")) e.target.src = LOGO_BASE + "default.png";
                   }} />
              <span class="rank">${rank}</span>
            </div>`
          : ""}
        <div class="info">
          <div class="name">
            <span class="name-text">${name}</span>
            ${isBest ? html`<span class="tag">Bestpreis</span>` : ""}
          </div>
          ${address ? html`<div class="addr">${address}</div>` : ""}
          ${chips.length ? html`<div class="chips">${chips}</div>` : ""}
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
          ? html`<button class="nav" title="Route starten" aria-label=${`Route zu ${name}`}
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
        <div>Keine Daten. Prüfe Entity-Namen (z.B. <code>${c.base_entity}_${this._fuel.start}</code>).</div>
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
        gap: clamp(6px, 2cqi, 10px);
        padding: clamp(6px, 2.4cqi, 12px);
        border-radius: 20px 20px 8px 8px;
        background:
          linear-gradient(90deg,
            rgba(255,255,255,.10) 0, rgba(255,255,255,.02) 2.5%,
            transparent 6%, transparent 94%,
            rgba(255,255,255,.02) 97.5%, rgba(255,255,255,.10) 100%),
          linear-gradient(180deg, rgba(255,255,255,.04), rgba(0,0,0,.25)),
          var(--mast);
        border: 1px solid rgba(255,255,255,.10);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.12),
          inset 0 -2px 0 rgba(0,0,0,.4),
          0 10px 28px rgba(0,0,0,.45);
        z-index: 1;
      }

      /* ---------- Krone (Leuchtkasten oben) ---------- */
      .crown {
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        min-height: 54px;
        padding: 8px 14px;
        border-radius: 14px 14px 6px 6px;
        background:
          linear-gradient(180deg, rgba(255,255,255,.35), rgba(255,255,255,0) 45%),
          var(--accent);
        color: #111;
        box-shadow:
          0 0 18px color-mix(in srgb, var(--accent) 45%, transparent),
          inset 0 -3px 0 rgba(0,0,0,.18);
      }
      .crown-light {
        position: absolute; inset: 0;
        background: radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,.45), transparent 60%);
        pointer-events: none;
      }
      .crown-icon { --mdc-icon-size: clamp(24px, 7cqi, 34px); position: relative; }
      .crown-text { position: relative; text-align: left; min-width: 0; }
      .crown-title {
        font-size: clamp(17px, 5.6cqi, 26px);
        font-weight: 900;
        letter-spacing: .08em;
        text-transform: uppercase;
        line-height: 1;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .crown-sub {
        font-size: clamp(10px, 2.8cqi, 12px);
        font-weight: 700;
        letter-spacing: .18em;
        text-transform: uppercase;
        opacity: .7;
        margin-top: 3px;
      }

      /* ---------- Preistafeln ---------- */
      .panels { display: flex; flex-direction: column; gap: clamp(5px, 1.6cqi, 8px); flex-grow: 1; }

      .panel {
        position: relative;
        display: grid;
        grid-template-columns: var(--cols-wide);
        align-items: center;
        column-gap: clamp(8px, 2.4cqi, 12px);
        row-gap: 6px;
        min-height: 64px;
        padding: 8px clamp(8px, 2.4cqi, 12px);
        border-radius: 10px;
        background: linear-gradient(180deg, #141414, #0b0b0b);
        border: 1px solid rgba(255,255,255,.07);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.05), inset 0 0 0 1px rgba(0,0,0,.6);
        cursor: pointer;
        outline: none;
        transition: background .2s, transform .12s, border-color .2s;
      }
      .panel:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent); }
      .panel:active { transform: scale(.985); }
      @media (hover: hover) {
        .panel:hover { background: linear-gradient(180deg, #1b1b1b, #101010); }
      }
      .panel.best {
        border-color: color-mix(in srgb, var(--led) 45%, transparent);
        box-shadow:
          inset 0 1px 0 rgba(255,255,255,.05),
          0 0 14px color-mix(in srgb, var(--led) 18%, transparent);
      }

      .logo { position: relative; width: clamp(38px, 11cqi, 48px); aspect-ratio: 1; }
      .logo img {
        width: 100%; height: 100%;
        object-fit: contain;
        border-radius: 8px;
        background: rgba(255,255,255,.92);
        padding: 3px;
        box-sizing: border-box;
      }
      .rank {
        position: absolute; top: -6px; left: -6px;
        min-width: 18px; height: 18px;
        border-radius: 9px;
        background: #2a2a2a;
        border: 1px solid rgba(255,255,255,.18);
        font-size: 11px; font-weight: 800; line-height: 16px; text-align: center;
        color: #ddd;
      }
      .panel.best .rank { background: var(--led); color: #000; border-color: transparent; }

      .info { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .name { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .name-text {
        font-size: clamp(14px, 4.2cqi, 17px);
        font-weight: 800;
        line-height: 1.15;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .tag {
        flex-shrink: 0;
        font-size: 9.5px; font-weight: 800;
        letter-spacing: .08em; text-transform: uppercase;
        padding: 2px 6px; border-radius: 6px;
        color: #000; background: var(--led);
      }
      .addr {
        font-size: 12px; color: #aaa; line-height: 1.25;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }
      .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
      .chip {
        display: inline-flex; align-items: center; gap: 3px;
        font-size: 11px; color: #ccc; line-height: 1;
        padding: 3px 6px; border-radius: 6px;
        background: rgba(255,255,255,.07);
      }
      .chip ha-icon { --mdc-icon-size: 13px; opacity: .8; }
      .chip.diff { color: #ff9c8f; background: rgba(255,80,60,.12); }

      /* ---------- LED-Preisanzeige ---------- */
      .price {
        position: relative;
        display: flex; align-items: center; justify-content: center;
        min-width: min(var(--price-min-width), 40cqi);
        box-sizing: border-box;
        padding: 6px 10px;
        border-radius: 7px;
        background: radial-gradient(120% 100% at 50% 40%, #050805, #000);
        border: 1px solid #2c2c2c;
        box-shadow: inset 0 0 12px color-mix(in srgb, var(--led) 12%, transparent), inset 0 2px 4px rgba(0,0,0,.8);
      }
      .digits { display: inline-flex; align-items: flex-start; }
      .led {
        display: inline-grid;
        font-family: "TripleDotDigital7", "Repet", ui-monospace, monospace;
        font-size: min(var(--price-font-size), 9.5cqi);
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }
      .led > span { grid-area: 1 / 1; white-space: pre; }
      .led .ghost { color: var(--led); opacity: .07; }
      .led .lit {
        color: var(--led);
        text-shadow:
          0 0 4px color-mix(in srgb, var(--led) 70%, transparent),
          0 0 12px color-mix(in srgb, var(--led) 35%, transparent);
      }
      .led.sup { font-size: calc(min(var(--price-font-size), 9.5cqi) * .62); margin-left: 2px; }

      .trend {
        position: absolute; top: 3px; left: 5px;
        font-size: 9px; line-height: 1;
      }
      .trend.up { color: #ff5a4a; }
      .trend.down { color: var(--led); }

      .nav {
        display: grid; place-items: center;
        width: 40px; height: 40px;
        border-radius: 50%;
        border: 1px solid rgba(255,255,255,.14);
        background: rgba(255,255,255,.06);
        color: #fff;
        cursor: pointer;
        padding: 0;
        transition: background .2s;
      }
      .nav ha-icon { --mdc-icon-size: 20px; }
      .nav:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      @media (hover: hover) { .nav:hover { background: rgba(255,255,255,.14); } }

      .foot {
        display: flex; align-items: center; justify-content: center; gap: 5px;
        font-size: 11px; color: #888; letter-spacing: .04em;
      }
      .foot ha-icon { --mdc-icon-size: 13px; }

      /* ---------- Standfuß ---------- */
      .base {
        position: relative;
        display: flex; justify-content: center; gap: 38%;
        height: 26px;
        margin-top: -2px;
      }
      .leg {
        width: clamp(14px, 6cqi, 26px);
        height: 20px;
        background: linear-gradient(90deg, #2b2b2b, #4a4a4a 40%, #262626);
        border-left: 1px solid rgba(255,255,255,.08);
      }
      .plinth {
        position: absolute; bottom: 0; left: 18%; right: 18%;
        height: 8px; border-radius: 3px;
        background: linear-gradient(180deg, #4a4a4a, #222);
        box-shadow: 0 6px 12px rgba(0,0,0,.45);
      }

      /* ---------- Responsiv (Breite der Karte) ---------- */
      /* Handy hochkant / schmale Spalte: Preis in eigene Zeile, groß */
      @container (max-width: 360px) {
        .panel { grid-template-columns: var(--cols-narrow); }
        .price {
          grid-column: 1 / -1;
          grid-row: 2;
          justify-content: flex-end;
          min-width: 0;
        }
        .led { font-size: min(calc(var(--price-font-size) * 1.25), 14cqi); }
        .led.sup { font-size: calc(min(calc(var(--price-font-size) * 1.25), 14cqi) * .62); }
        .addr { -webkit-line-clamp: 1; }
      }
      /* sehr schmal (z.B. 3er-Spalte im Sections-Grid) */
      @container (max-width: 240px) {
        .logo, .addr, .chips, .crown-icon, .crown-sub { display: none; }
        .panel { grid-template-columns: minmax(0,1fr) auto; }
        .nav { width: 34px; height: 34px; }
      }
      /* breit (Tablet / Wandpanel) */
      @container (min-width: 560px) {
        .panel { min-height: 76px; }
        .name-text { font-size: 19px; }
        .addr { font-size: 13px; }
      }

      /* Animation */
      @keyframes pricePulse {
        0% { transform: scale(1); }
        30% { transform: scale(var(--pulse-scale, 1.045)); }
        100% { transform: scale(1); }
      }
      @keyframes glowPulse {
        0%, 100% { box-shadow: inset 0 0 12px rgba(0,255,0,.1), 0 0 0 transparent; }
        35% {
          box-shadow:
            inset 0 0 calc(18px * var(--glow-strength, 1)) rgba(0,255,0,.12),
            0 0 calc(18px * var(--glow-strength, 1)) var(--glow-color);
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
const SCHEMA = [
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
              { value: "diesel", label: "Diesel (Sensoren 1–5)" },
              { value: "super", label: "Super (Sensoren 6–10)" },
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
    title: "Darstellung",
    schema: [
      {
        type: "grid",
        name: "",
        schema: [
          { name: "card_color", selector: { text: {} } },
          { name: "accent_color", selector: { text: {} } },
          { name: "led_color", selector: { text: {} } },
          {
            name: "decimal_separator",
            selector: { select: { mode: "dropdown", options: [{ value: ".", label: "Punkt (1.94⁹)" }, { value: ",", label: "Komma (1,94⁹)" }] } },
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
    title: "Funktionen",
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
                  { value: "apple", label: "Apple Karten" },
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
    title: "Animation",
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
  base_entity: "Basis-Entity (z.B. sensor.leonding)",
  fuel_type: "Spritart",
  count: "Anzahl Tankstellen",
  location_name: "Ortsname (Untertitel, wird aus Adresse entfernt)",
  title_override: "Titel (leer = Standard)",
  card_color: "Mastfarbe (z.B. #1c1c1c)",
  accent_color: "Akzentfarbe Krone (leer = automatisch)",
  led_color: "LED-Farbe",
  decimal_separator: "Dezimaltrenner",
  price_box_min_width: "Min. Breite Preisbox",
  price_font_size: "Schriftgröße Preis",
  show_header: "Krone (Titel) anzeigen",
  show_logos: "Logos anzeigen",
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
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._config}
        .schema=${SCHEMA}
        .computeLabel=${(s) => LABELS[s.name] ?? s.name}
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
    name: "Tankstellen Preismast",
    preview: true,
    description: "Spritpreise im Look einer Tankstellen-Preissäule – responsiv, mit Bestpreis, Entfernung, Navigation & Preis-Animation.",
  });
}

console.info(`%c TANKSTELLE-CARD %c v${CARD_VERSION} `, "background:#f2b705;color:#000;font-weight:700", "background:#111;color:#0f0");
