# Testování

## Instalace

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
npm install
npx playwright install chromium
```

Node.js a prohlížeče Playwright jsou pouze vývojové závislosti. Produkční
Docker image je neobsahuje.

## Kompletní sada

```bash
./scripts/test-all.sh
```

Skript postupně spustí pytest, Vitest a Playwright. E2E server používá
samostatnou databázi `/tmp/vetrelci-stanice-e2e.sqlite` a deterministický
režim `?test=1`. Testovací API `window.__game` bez tohoto parametru neexistuje.
Composer je v testovacím režimu záměrně vypnutý a vizuály používají levnější
profil; gameplay a kolize se nemění.

Jednotlivé vrstvy lze spustit samostatně:

```bash
python3 -m pytest
npm run test:unit
npm run test:e2e
```

## Manuální checklist

- Login odmítne prázdné a příliš dlouhé jméno.
- Vysoká i nízká kvalita jsou čitelné při jasu 50 %, 100 % a 150 %.
- VYSOKÁ kvalita hlásí v debug overlayi `COMPOSER`, `SSAO ON`, `SHADOW ON`;
  NÍZKÁ hlásí `SSAO OFF`, `SHADOW OFF`.
- Bloom zasahuje emissive pásy, oči, displeje a projektily, nikoli běžné stěny.
- Panelové spáry, podlahový protiskluz a štítky beden/sudů jsou zřetelné.
- Kovové povrchy mají jemné environment odlesky a nejsou ploché ani plastové.
- Smrt vetřelce vytvoří fragmenty a částice; sud vytvoří kouř a rázovou vlnu.
- Kvalita a jas zůstanou po obnovení stránky uložené.
- Hráč ani nepřátelé neprojdou zdmi, bednami, lodí, reaktorem, modulem ani přepážkou tunelu.
- V každé ze 9 sekcí jsou počáteční nepřátelé nejméně 15 jednotek od startu a první
  3 sekundy neaggrují ani neútočí; platí také po restartu a „HRÁT ZNOVU“.
- Nepřítel za přepážkou bez LOS neaggruje; výstřel v doslechu ho přitáhne.
- Spawny se liší mezi běhy; v `?test=1` jsou deterministické (`getSpawnSeed()`).
- HUD zobrazuje `SEKCE x/9`.
- Stropní lovec začíná hlavou dolů na stropě, varuje skřekem, dopadne na
  podlahu, několik sekund útočí a poté se vrátí. Na radaru nahoře bliká.
- Škrábání stropního lovce je přes HRTF slyšet z jeho skutečné pozice nad hráčem.
- Podlahové spáry, rošty a úniková trasa nejsou emissive; hlavní světlo vychází
  ze stropních fixture a startovní výklenek má vlastní stropní světlo.
- Brokovnice v levelu 2 a plamenomet v levelu 4 správně spotřebovávají munici.
- Sud poškodí okolní cíle a odpálí sousední sudy.
- `E` aktivuje airlock jen jednou; O₂ zóna odečítá kyslík a po vyčerpání HP.
- `T` položí nejvýše jednu získanou věžičku; věžička po čase nebo munici zmizí.
- Modré body radaru zmizí po záchraně přeživších.
- Smrt Královny spustí 60s odpočet; modul udělí časový bonus, timeout ukončí hru.
- Po smrti i vítězství se leaderboard obnoví a zobrazí nejvýše deset položek.
- Síťový panel neobsahuje požadavky na externí domény.

Pro diagnostiku lze použít `/?debug=1`; růžové wireframy zobrazí AABB a overlay
FPS, frame/render budgety i počet GPU resources. `window.__game.benchmark()`
je dostupný pouze společně s `?test=1`.
