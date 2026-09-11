# EPDeeznuts — *Materia*

Platform voor het berekenen, verifiëren en publiceren van milieuprofielen van beton — EPD/BEPD volgens EN 15804+A2, modules A1 t.e.m. A5.

De toepassing draagt in de interface de naam **Materia**; `EPDeeznuts` is de repositorynaam. Het ontwerp volgt het Claude Design-bestand *Materia Portaal* (designsysteem "nocturne", omgekeerd naar zijn lichte ramp).

---

## Waarom

Vanaf **2028** moet het E-peil van een woning ook de milieu-impact van de gebruikte materialen bevatten. Vanaf **2030** hoort die impact bij de CE-markering van beton: elke centrale zal haar milieuparameters moeten rapporteren, per receptuur.

Dat botst op drie praktische problemen:

1. **Eén generiek cijfer voor beton bestaat niet.** In de demodataset hieronder levert dezelfde sterkteklasse C30/37 tussen 119 en 311 kg CO₂ eq./m³, afhankelijk van het cementtype en of de granulaten per schip of per vrachtwagen toekomen. Een ontwerpberekening op het gemiddelde kan er bijna een factor twee naast zitten.
2. **Per receptuur een externe verificatie laten uitvoeren is onbetaalbaar.** Een centrale heeft duizenden recepturen en past ze wekelijks aan.
3. **A4 en A5 kunnen niet door de producent gecertificeerd worden.** Het transport naar de werf en de verwerking ter plaatse hangen van de werf af, niet van de fabriek.

Deze toepassing lost dat op door de berekening te automatiseren, de verificatie bij de externe instelling te laten waar ze hoort, en de verantwoordelijkheid per levenscyclusmodule expliciet toe te wijzen.

---

## Snel starten

```bash
node --version      # 22.5 of hoger
npm start           # http://localhost:3000
```

Geen `npm install` nodig: de toepassing heeft **geen runtime-afhankelijkheden**. De databank (SQLite) wordt bij de eerste start aangemaakt en gevuld met masterdata en een demodataset.

```bash
npm test            # 56 tests
npm run reset       # databank wissen en opnieuw opbouwen
DEMO_DATA=0 npm start   # starten zonder fictieve organisaties
```

### Demo-accounts

Wachtwoord voor alle accounts: `demo1234`. Ze staan ook op het aanmeldscherm, aanklikbaar.

| Rol | Account | Organisatie |
|---|---|---|
| Grondstofleverancier | `katrien@heidelberg.demo` | Heidelberg Materials Benelux |
| Grondstofleverancier | `dirk@sagrex.demo` | Sagrex Granulaten |
| Betonproducent | `lars@deschelde.demo` | Betoncentrale De Schelde (aan het water) |
| Betonproducent | `peter@vandenberghe.demo` | Beton Vandenberghe (binnenland) |
| Aannemer | `jonas@verhoeven.demo` | Aannemingen Verhoeven |
| Verificateur | `ilse@certibeton.demo` | Certibeton Verificatie |
| Sectorfederatie | `bart@betonfederatie.demo` | Federatie van de Betonindustrie |
| Overheid | `hilde@fod.demo` | FOD Economie |

### Demo in tien minuten

Bovenaan staat een **rolwissel**. Die meldt echt aan als die persona in plaats van alleen de weergave te veranderen — anders zou het platform rechten voorwenden die het niet afdwingt.

1. **Als producent** (`lars@deschelde.demo`) → *Recepturen* → `C30/37-EE3-S4` → **Rekenblad openen**.
   Pas de cementdosering aan: het resultaat rechts rekent mee terwijl u typt, en er verschijnt een melding dat de wijziging nog niet bewaard is. Onderaan staat elke rekenterm met zijn formule, zijn factor, de bron van die factor en het BEPD-nummer erachter.
2. Klik in **Cement — bron** op *Klinkerarm bindmiddel ACT (proef)*. Het oordeel slaat om naar **Ongeldig**: dat bindmiddel draagt enkel een eigen opgave. De berekening loopt door, het resultaat is waardeloos. Kies *CEM I 52,5 R (Lixhe)* en het wordt **Geldig met opmerking** — een internationale EPD is toegelaten, maar gemerkt.
3. **Bewaren als nieuwe versie** met een kleine wijziging: het systeem zegt meteen dat ze binnen de bandbreedte blijft en geen verificatie nodig heeft. Doe het met 60 kg minder cement en het gaat terug naar het controlebureau, met de reden erbij.
4. Knop **Transparantierapport** rolt het volledige dossier uit: inputs, parameters, elke term, de gebruikte masterdata en de audittrail.
5. **Als verificateur** (`ilse@certibeton.demo`) → probeer een ongeldig dossier vrij te geven. Dat wordt geweigerd: een controlebureau kan een gat stroomopwaarts niet dichtschrijven.
   Tabblad *Automatisch aanvaard*: de wijzigingen die nooit bij u kwamen, met hun afwijking. Tabblad *Afwijkingen van sectorwaarden*: uw eigenlijke controlelijst.
6. **Als aannemer** (`jonas@verhoeven.demo`) → een project → een levering → **Controle uitvoeren**. Hier komen A4 en A5 erbij, met het go/no-go-oordeel en de manuele uitzondering.
7. **Als federatie** (`bart@betonfederatie.demo`) → *Generieke waarden*. De bandbreedte 119–311 kg CO₂ eq./m³ voor dezelfde klasse — het argument waarom een generiek cijfer alleen niet volstaat.

---

## De regels waar het om draait

### 1. De ketenregel

Een resultaat is pas als BEPD bruikbaar wanneer **élke** grondstof zelf door een geldige BEPD gedekt is.

| Bewijsstuk | Oordeel | Gevolg |
|---|---|---|
| BEPD (geverifieerd, Belgisch) | Geldig | Publiceerbaar, telt mee in sectorgemiddelden |
| Internationale EPD / erkende databank | Geldig met opmerking | Bruikbaar en verifieerbaar, maar gemerkt en nooit in de gemiddelden |
| Generieke sectorwaarde | Indicatief | Enkel voor ontwerpramingen |
| Eigen opgave | Ongeldig | De berekening loopt door, het resultaat heeft geen waarde |

Ook een vervallen BEPD, een BEPD zonder registratienummer en een ontbrekende verplichte module maken het resultaat ongeldig.

### 2. De moduletoewijzing

De vraag die elke auditor stelt: waar landt de verklaring van de leverancier?

```
cement A1–A3 van de leverancier   →  A1 van het beton
cementfabriek → betoncentrale     →  A2 van het beton   (berekend door het platform)
mengen op de centrale             →  A3 van het beton   (procesparameters)
centrale → werf                   →  A4                 (per levering)
plaatsen, verdichten, afval       →  A5                 (door de aannemer)
```

De A2 van de betoncentrale staat in geen enkele leveranciersverklaring, want de leverancier weet niet wie er koopt. Europese productregels laten cement daarom stoppen bij A3.

### 3. De wijzigingscontrole

Recepturen wijzigen voortdurend. Elke wijziging extern laten verifiëren is onbetaalbaar; geen enkele controleren is onverdedigbaar. Drie grendels tegelijk:

| Grendel | Standaard | Waarom |
|---|---|---|
| Marge per wijziging | ± 3 % GWP | Kleine optimalisaties erven de bestaande verificatie |
| Opgetelde drift | ± 7,5 % | Twintig stapjes van 2,5 % zijn samen 50 % die niemand zag |
| Opeenvolgende bypasses | max. 5 | Na vijf keer altijd een volledige controle |
| Nieuwe grondstof | altijd controleren | Een gewijzigde samenstelling gaat nooit automatisch door |

Bovendien komt een dossier dat niet volledig BEPD-gedekt is nooit door de bypass. Alle drempels zijn instelbaar door de federatie, want ze liggen op Vlaams niveau nog niet vast.

### 4. Vertrouwelijkheid

Een cementproducent wil niet dat een centrale die niets bij hem koopt zijn declaraties leest. Tegelijk moet die centrale het product wél kunnen vinden. Daarom: de catalogus toont naam, categorie en leverancier van alles; de cijfers komen pas na een toegekende toegangsaanvraag. Aanvraag én beslissing staan in de audittrail.

### 5. Verantwoordelijkheid per module

Per project wordt vastgelegd wie A4 en wie A5 draagt. Alleen die organisatie kan die cijfers invullen, en de audittrail houdt bij wie het deed — de reden waarom gedeelde accounts hier niet werken.

### 6. Wat het go/no-go *niet* is

De leveringscontrole zegt of een levering gedekt is door een geldige declaratie. Ze is geen leveringsverbod: de betonproducent blijft, net als vandaag, verantwoordelijk voor het beton dat hij levert. Ligt het platform plat of kan de controle niet afgerond worden, dan legt de betrokken partij een **manuele uitzondering** vast met verantwoording. Die verschijnt op de controlelijst van de verificateur. Werk stopt nooit omdat software stilvalt.

---

## Architectuur

```
server/
  domain/          de eigenlijke logica, zonder HTTP of databank in het zicht
    constants.js     indicatoren, modules, bewijstypes, oordelen
    validity.js      de ketenregel
    calc.js          de rekenmotor met volledige trace
    changes.js       de bypass-regels
    versioning.js    effectief-gedateerde versies
    declarations.js  de dossierlevenscyclus
    aggregate.js     sectorgemiddelden met spreiding
    report.js        het transparantierapport
    permissions.js   rollen en datadeling
  db/              schema, migratie, seed, twee drivers
  http/            router, routes, statische bestanden
public/            de client: ES-modules, geen buildstap
  css/app.css        designsysteem "nocturne" — tokens en componentklassen
  js/lib/icons.js    eigen lijniconen, inline SVG (geen CDN)
  js/views/          één bestand per scherm
test/              52 tests (node --test)
api/index.js       Vercel-ingang
```

Drie ontwerpbeslissingen die de rest verklaren:

**Alles is effectief gedateerd.** Materialen en recepturen worden nooit ter plaatse aangepast: een wijziging sluit de lopende versie af en opent een nieuwe. Een verificatie in november kan daardoor nog exact reconstrueren welke cijfers golden tijdens een levering in augustus. Ook masterdata (transport- en energiefactoren) is gedateerd; een berekening verwijst altijd naar de versie die gold op haar referentiedatum.

**Elke rekenterm verklaart zichzelf.** De motor produceert geen totaal maar een lijst termen, elk met inputs, factor, herkomst van die factor en het bewijsstuk erachter. De voorwaarde van de administratie was dat de rekenregels sluitend en transparant zijn; een term die zichzelf niet kan uitleggen hoort niet in de motor.

**Eén rekenpad.** Het rekenblad rekent live mee terwijl een producent doseringen bijstelt, maar die voorbeeldberekening loopt via `POST /calculate` door exact dezelfde motor als een ingediende versie. De client rekent zelf niets uit. Twee rekenpaden die uit elkaar groeien is precies het soort verschil dat een verificateur terecht niet vertrouwt.

Bij indiening wordt de berekening **bevroren** in `result_json`. Wat een verificateur ondertekent, mag daarna niet stilzwijgend veranderen doordat een transportfactor bijgewerkt werd. Het rapport zegt expliciet of u naar de vastgelegde momentopname kijkt of naar een herberekening, en toont het verschil als dat er is.

---

## Uitrollen op Vercel

De repository is klaar om te deployen. Twee zaken zijn belangrijk:

**1. Zet `DATABASE_URL`.** Serverless functies hebben een vluchtig bestandssysteem; SQLite zou daar elke schrijfactie verliezen. Met `DATABASE_URL` ingesteld praat de toepassing met Postgres (Vercel Postgres, Neon en Supabase werken alle drie). Het schema wordt bij de eerste cold start aangemaakt, met een advisory lock zodat gelijktijdige instanties elkaar niet in de weg lopen.

```bash
vercel env add DATABASE_URL         # postgres://…
vercel env add DEMO_DATA            # "0" om zonder fictieve organisaties te starten
vercel deploy --prod
```

**2. `pg` is een optionele afhankelijkheid.** Vercel installeert ze automatisch; lokaal blijft de checkout dependency-vrij zolang `DATABASE_URL` niet gezet is.

De client in `public/` wordt rechtstreeks vanaf de edge geserveerd en bereikt de functie nooit — daarom gebruikt hij hash-routing, zodat er geen rewrites nodig zijn. `vercel.json` stuurt enkel `/api/*` naar de functie.

Draaien op een gewone server kan ook: `npm start` bedient API én client op één poort.

---

## API

Alle eindpunten zitten onder `/api` en verwachten een sessiecookie (`POST /api/auth/login`).

| | |
|---|---|
| `GET /reference` | indicatoren, modules, factoren, drempelwaarden |
| `GET /materials`, `POST /materials`, `POST /materials/:id/versions` | grondstoffen en hun versies |
| `GET/POST /access`, `POST /access/:id/decide` | toegangsaanvragen |
| `GET/POST /recipes`, `POST /recipes/:id/versions` | recepturen |
| `GET /recipe-versions/:id/calculate` | de berekening met volledige trace |
| `POST /calculate` | voorbeeldberekening op een nog niet opgeslagen samenstelling |
| `GET /recipe-versions/:id/change-check` | moet dit langs een verificateur? |
| `GET /recipe-versions/:id/report` | het transparantierapport |
| `POST /declarations`, `.../take`, `.../decide`, `.../publish` | de dossierlevenscyclus |
| `POST /projects/:id/deliveries`, `PATCH /deliveries/:id/parameters` | leveringen en A4/A5 |
| `POST /deliveries/:id/gate`, `.../override` | de leveringscontrole |
| `GET /aggregation/preview`, `GET /aggregations/:id/totem` | sectorgemiddelden en export |
| `GET /audit` | de audittrail |

---

## Wat hier demonstratie is, en wat productie nog nodig heeft

Eerlijk over de grens tussen beide:

**Werkt echt.** De rekenmotor, de ketenregel, de wijzigingscontrole, de versiebeheer, de rechten en datadeling, de audittrail, het transparantierapport, de sectoraggregatie en de export — allemaal echte implementaties met tests.

**Nog nodig voor productie:**

- **Het ontwerp.** De interface volgt het geleverde Claude Design-bestand, maar de bijhorende stylesheet van het designsysteem zat er niet bij. De tokens in `public/css/app.css` zijn gereconstrueerd uit de kleuren in het ontwerp zelf; de Phosphor-iconen zijn vervangen door een eigen set in dezelfde tekenstijl, zodat de toepassing zonder netwerk blijft werken. Met de echte stylesheet erbij vervangt u dat bestand.
- **Aanmelding.** Nu wachtwoorden met scrypt. In productie hoort dit via de identiteitsprovider van elke organisatie (Entra ID was het plan). De rest van de code weet niet hoe iemand zich identificeerde en verandert daar niet voor.
- **Cijfers in de masterdata.** De transport- en energiefactoren zijn realistische ordes van grootte uit gepubliceerde datasets, maar elke rij heeft een afgesproken bronvermelding nodig voordat er een juridisch bindend cijfer uit rolt. Daarom is `source` verplicht in het schema.
- **Bijlagen.** Verantwoordingsnota's en meetrapporten worden nu als link opgeslagen, niet als bestand.
- **ERP-koppelingen.** Geen enkele centrale zet iemand fulltime aan het overtikken. De API is er; de koppelingen met de drie courante pakketten zijn het echte integratiewerk.
- **De drempelwaarden zelf.** 3 % / 7,5 % / 5 zijn plaatsvervangende getallen. Welke waarden het worden, is precies wat op Vlaams niveau nog beslist moet worden — vandaar dat ze instelbaar zijn in plaats van ingebakken.
- **Beschikbaarheid.** Als dit platform in de keten van elke betonlevering in België komt te staan, is uptime een contractueel gegeven, geen technisch detail. De manuele uitzondering is de ontsnappingsklep, maar ze vervangt geen SLA.
