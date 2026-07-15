# Changelog

## Unreleased

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
