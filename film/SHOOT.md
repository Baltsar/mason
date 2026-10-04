# Apprentice — filmerna

Uppdaterad 10:55. De tre filmerna genereras helt av skript. Ingen inspelning krävs.

| Film | Fil | Längd | Röster |
|---|---|---:|---|
| Team introduction | `out/01-team-introduction.mp4` | 54,6 s | nyhetsankare och reporter |
| Product demo | `out/02-product-demo.mp4` | 57,5 s | ankare, reporter och Apprentice egen röst |
| Technical walkthrough | `out/03-technical-walkthrough.mp4` | 55,7 s | Apprentice egen röst |

## Hur de är gjorda

1. **Bild.** `edit/capture.mjs` öppnar appens fönster i en huvudlös Chrome mot en tyst kopia av appen och en kopia av datat, flyttar en pekare, klickar och sparar varje bildruta. `edit/slides.mjs` sparar bilderna i `walkthrough.html`.
2. **Röst.** `edit/narrate.mjs` skickar filmens alla repliker i en begäran till ElevenLabs Text to Dialogue, samma motor som appens veckoavsnitt, och lyssnar sedan på tagningen för att hitta var varje replik sägs.
3. **Klipp.** `edit/compose.mjs` håller varje bild så länge dess repliker sägs och lägger textning. `edit/build.mjs` kodar filmen.

Manus och bildval per film ligger i `edit/films/*.json`.

```bash
node edit/narrate.mjs edit/films/demo.json
node edit/compose.mjs edit/films/demo.json
```

Node 22 behövs. `ffmpeg` här saknar textfilter, därför renderas all text som stillbilder av Chrome.

## Vill du synas

Lägg ett kort klipp i `film/raw/` och bygg om med `compose.mjs`. Finns filen används den i stället för textkortet.

| Fil | Var den hamnar |
|---|---|
| `raw/me-hook.mp4` | Demofilmen 0–6 s, under "In a month, he won't remember how." |
| `raw/me-tired.mp4` | Demofilmen 49–53 s, under "He did not record this video. He was tired." |
| `raw/me-team.mp4` | Teamfilmen 0–6 s, under "The team is one person." |
| `raw/team.jpg` | Teamfilmen 7–13 s, under ditt namn |
| `raw/me-team-end.mp4` | Teamfilmen 46–50 s, under "He would tell you this himself." |

Ljudet i dina klipp används inte. Rösterna ligger kvar.

## Cold Open

Alla tre filmerna är körda genom Cold Open som jurypublik, på de färdiga filerna: ljudet avlyssnat och bildrutor lästa. Inga underkända kontroller, betyg `usable`, tak `best`.

Två saker ändrades efter första körningen:

- Första meningen var inte avslutad före sekund 4 i demofilmen och teknikfilmen. Nu ligger en paus efter den, och teknikfilmen öppnar med "No screenshots. Events, not pixels."
- Teamfilmen nämnde inte något som räknas som produkten inom 10 sekunder. Reportern säger nu "We're Apprentice, the app he built."

## Det som sägs och är kontrollerat

- 120 agentsessioner på 21 dagar i 37 mappar: räknat i `~/.claude/projects`.
- 8 projekt, 175 instruktioner, senaste natten onsdag 03:13: ur veckoavsnittets egna totalsiffror.
- "Ja sluta fråga publicera", sagt två gånger, blev regeln "Publicera utan att fråga mig": syns i Work Map.
- "He did not record this video": sant.
