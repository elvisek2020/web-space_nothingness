# Changelog

## Unreleased

## v4.2 — hotfix layout grafu (kořenová příčina v4.1 symptomů)

### Diagnóza (ne symptomy)
- Geometrie a navigace nebyly svázané: `floorPoints` / `bossArena.center=(0,0,0)` vs ad-hoc mesh.
- Plná solid `tunnel-partition` blokovala vstup do modulů (vizuální portal nad kollidérem).
- Okna bez outer collideru → díry ven; boss ve středu dutého torusu; žlutý `ring-trim` uprostřed decku.
- Entity ve zdech: spawny mimo jednotný nav-graph; props (sudy, airlock) ucpávaly doky.

### Opravy
- **`station-layout.js`:** jediný zdroj pravdy — ring/modules/tunnels/openings, `navNodes`/`navEdges`, `validate()` + BFS, `bossAnchor` v dosahu.
- **Doky:** dveřní rám (jambs + vizuální lintel bez XZ kollideru); výřez outer wall + hull u doků; end-cap modulů otevřený k tunelu.
- **Hull shell:** pojistka mimo walkable (neblokuje pohyb v tunelu/modulu).
- **Spawny:** kandidáti z `navNodes` + runtime rescue; sudy/props mimo dock clear zónu; airlock na ring mimo doky.
- **Boss:** aréna = poslední modul layoutu; spawn + HUD ⚠ BOSS po vyčištění vlny.
- Pryč produkční `ring-trim` uprostřed koridoru (kick-plate na stěnách).

### Testy
- Unit: `station-layout` validate/BFS na 9 levelech; floor/wall integrity.
- E2E: průchod ring→každý modul a zpět; spawn multi-seed bez `insideCollider`; boss dostupný + HUD; floor/wall integrity.

## v4.1 — hotfix regresí po přestavbě stanice

### Proč regrese prošly zelenými testy
- E2E pohyb volal `window.__game.move()`, které posouvá hráče mimo skutečné `keydown`/fyziku.
- Smoke audit teleportoval na okraj bounds, ne na `playerStart`.
- Kolizní systém používal AABB i pro „rotované“ segmenty; po přechodu na yawovaný OBB se navíc ukázala chybná inverzní rotace (`−yaw` vs Three.js `Ry`).

### Opravy
- **Pohyb:** OBB kollidéry s `yaw` + správná Three.js transformace; prstencové stěny s tangenciálním yaw a radiálním odstupem chordů.
- **Cache busting:** `Cache-Control: no-cache` na static assets + `?v={{ app_version }}` u CSS/JS/importmap.
- **Podlaha:** sektory `RingGeometry` + overlapping spoje tunel/modul; analytický walk-test bez děr.
- **Stutter při palbě:** pool projektilů, muzzle smoke, PointLight (`castShadow=false`), pooled particle bursts; debug `ALLOC` čítač.
- **Menu:** grid `1fr 1fr` ve stávající šířce karty, čitelnější instrukce; stack pod ~800 px. Game-over/victory beze změny layoutu.

### Výkon palby (Retina MacBook, kvalita VYSOKÁ, držení palby)
- **PŘED (v4):** min. FPS ≈ 35–42, viditelné GC špičky při create/dispose projektilů.
- **PO (v4.1):** min. FPS ≈ 58–62, alokace za frame během warm poolu = 0 (měřeno debug `ALLOC` + headless E2E).

### Testy
- E2E reálný keyboard WASD, floor integrity na 9 levelech, spawn/OBB, sustained fire allocations.
- Unit: OBB vs inflated AABB, `floor-walk` na všech layoutách.
- Pytest: `Cache-Control: no-cache` + verzované URL v indexu.

## v4 — redesign stanice, 9 úrovní, vnímání, výkon

- **Leaderboard UI:** širší tabulka Top 10 (720–900 px), responzivní menu/game-over/victory layout.
- **Architektura stanice:** okružní torus chodba + válcové moduly s dokovacími tunely, přepážkami a cupolou; `MIN_CEILING` 6.5 m.
- **Vnímání:** `perception.js` — LOS raycast, zorný úhel, sluchová alerta po výstřelu (rádius dle zbraně).
- **Spawny:** náhodný seed per běh, pevný `FIXED_TEST_SEED` v test módu; validní floor body v prstenci i modulech.
- **9 sektorů:** progrese dle tabulky v4, elitní multiplikátory, noví bossové (Matka lovců, alfa smečka, dvojice pretoriánů, strážce reaktoru); finále na úrovni 9.
- **Boss fyzika:** clamp skoků nad podlahu/strop (`stalker-physics.js`).
- **Výkon (PŘED → PO, headless benchmark v CI):** ~15–25 FPS → ~40+ FPS při 20 snímcích; shadow `autoUpdate=false`, pixel ratio cap 2.0/1.25, HUD diff update, max 8 audio hlasů, spatial grid pro raycasty.
- Testy: 12 pytest + 32 Vitest + 11 Playwright (wall-testy 9 levelů, LOS, spawn seed, boss Y).

## v3.1 a dříve

- v3.1: každá úroveň začíná v osvětleném bezpečném výklenku; spawn body drží
  15jednotkový odstup a nepřátelé mají třísekundovou pasivní fázi.
- v3.1: odstraněné podlahové emissive kanály a podsvícení roštů, světelnou
  čitelnost nově zajišťují stropní fixture a neutrální ambient.
- v3.1: letouny nahradil stropní lovec s patrol/warning/jump/ground/return FSM,
  balistickým přepadem, pavoukovitým modelem, HRTF zvuky a blikáním na radaru.
- Nový lokální Three.js r185 EffectComposer s bloomem, SSAO, OutputPass a
  quality profily; testovací režim používá deterministický přímý render.
- RoomEnvironment/PMREM odlesky, PBR materiály a generované color, roughness
  a normal textury pro stěny, podlahy, bedny, sudy, terminály a výstražné pásy.
- Modulární rámy, rošty, světelné kanály, kabelové lávky, greebles a pára.
- Detailnější animovaní vetřelci s clearcoat krunýřem, ocasy, kusadly,
  článkovanými končetinami a boss pláty.
- Detailnější viewmodely zbraní, emissive indikátory munice, muzzle flash,
  kouř, jiskry, kyselinové efekty, fragmentace a rázové vlny.
- Debug overlay s FPS a GPU statistikami, render benchmark a lifecycle testy.
- Zesvětlené prostředí, barevné orientační prvky a uložený jas/kvalita.
- Sdílené XZ kolize se substeppingem a diagnostické AABB.
- Brokovnice, plamenomet, munice a výbušné sudy s řetězovou reakcí.
- Airlock, kyslíkové zóny, sentry věžička a záchrana přeživších.
- Sebedestrukce po smrti Královny a časovaný útěk k modulu.
- Deterministické testovací API, pytest, Vitest a Playwright sada.
- Vývojové Python/Node závislosti oddělené od produkčního Docker image.
