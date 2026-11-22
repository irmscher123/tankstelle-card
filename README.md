# Tankstellen Preismast (tankstelle-card)

Lovelace-Karte für Home Assistant: Spritpreise im Look einer Tankstellen-Preissäule – responsiv für Handy, Tablet und Wandpanel.

![Vorschau](docs/preview.png)

## Funktionen
- Krone mit Spritart (Diesel/Super), Mast, LED-Preistafeln, Standfuß
- Letzte Preisstelle hochgestellt (1.94⁹), LED-Hintergrundsegmente
- Bestpreis-Markierung, Differenz in Cent, Entfernung von Zuhause
- Navigations-Button (Google Maps, Apple Karten, Waze)
- Trendpfeile und Animation bei Preisänderung
- Passt sich der Kartenbreite an (Container-Queries), Sections-Grid-tauglich
- Visueller Editor

## Installation (HACS)
1. HACS → ⋮ → *Benutzerdefinierte Repositories* → `https://github.com/irmscher123/tankstelle-card`, Typ **Dashboard**
2. „Tankstellen Preismast“ installieren, Browser neu laden

## Konfiguration
```yaml
type: custom:tankstelle-card
base_entity: sensor.leonding   # Sensoren sensor.leonding_1 … _10
fuel_type: diesel              # diesel (1–5) | super (6–10)
count: 5
location_name: Leonding
```

| Option | Standard | Beschreibung |
|---|---|---|
| `title_override` | – | eigener Titel |
| `card_color` | `#1c1c1c` | Mastfarbe |
| `accent_color` | auto | Farbe der Krone |
| `led_color` | `#00ff00` | LED-Farbe |
| `decimal_separator` | `.` | `.` oder `,` |
| `price_font_size` / `price_box_min_width` | 26 / 130 | Preisanzeige in px |
| `superscript_digit`, `ghost_digits` | true | Säulen-Optik |
| `show_header`, `show_logos`, `show_base`, `show_updated` | true | Elemente ein/aus |
| `highlight_cheapest`, `show_diff`, `show_distance`, `show_navigation` | true | Funktionen ein/aus |
| `nav_provider` | `google` | `google`, `apple`, `waze` |
| `trend_minutes` | 60 | Dauer der Trendpfeile (0 = aus) |
| `animate_changes`, `up_color`, `down_color`, `pulse_scale`, `glow_strength` | | Animation |

Schrift (optional): `/config/www/fonts/triple_dot_digital-7.ttf`
