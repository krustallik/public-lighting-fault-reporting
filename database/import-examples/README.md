# Príklady importu svetelných bodov

Súbory v tomto priečinku slúžia ako **vzor pre admin import** (`/panel-svietidla/import` — cesta sa nastavuje cez `VITE_ADMIN_BASE_PATH`).

Podporované formáty: **CSV**, **JSON**, **GeoJSON**.

## Povinné polia

| Pole | Alternatívne názvy v importe |
|------|------------------------------|
| Inventárne číslo | `inventoryNumber`, `inventory_number`, `external_id` |
| Zemepisná šírka | `latitude`, `lat` |
| Zemepisná dĺžka | `longitude`, `lng`, `lon` |

Voliteľné: `address`, `district`, `lampType` / `lamp_type`, `status` (`active`, `inactive`, `maintenance`).

## Súbory (po 3 záznamy)

| Súbor | Formát | Inventárne čísla (seed.sql) |
|-------|--------|----------------------------|
| `street-lights.example.csv` | CSV | 254, 255, 248 |
| `street-lights.example.json` | JSON | 231, 258, 283 |
| `street-lights.example.geojson` | GeoJSON | 210, 206, 201 |
| `street-lights.pagination-test.csv` | CSV (21 riadkov) | 251–220 (seed.sql id 17–37) |

Každý formát má **iné 3 body** z `seed.sql` na otestovanie importu. Súbor `street-lights.pagination-test.csv` slúži na overenie **stránkovania náhľadu** (10 záznamov na stranu → 3 strany).

### CSV — komentáre

Riadky začínajúce `#` sa pri parsovaní **preskočia** (môžete doplniť poznámky nad hlavičku).

## Postup testu

1. Admin → **Import** → nahrajte súbor → **Náhľad importu**.
2. Ak bod už existuje (rovnaké inventárne č.), preview ukáže **update** — potvrďte s „Povoliť aktualizáciu“.
3. Nové inventárne čísla sa vytvoria ako **create**.
