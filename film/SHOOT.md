# Apprentice — inspelning

Uppdaterad 10:20 efter `BRIEF.md`. Historien: jag byggde det genom att prata med agenter, en månad senare kan jag inte förklara det, Apprentice var där.

Du gör fyra inspelningar. Jag gör all annan bild, klippning och textning.

| # | Du spelar in | Fil | Din tid |
|---|---|---|---|
| 1 | Förhöret: Apprentice frågar dig om ditt eget projekt | `raw/recall.mp4` | 90 s |
| 2 | Frågan vid pausen | `raw/ask.mp4` | 1 min |
| 3 | Stoppet | `raw/stop.mp4` | 1 min |
| 4 | En tagning mot kameran där du läser alla rader nedan | `raw/lines.mp4` | 3 min |
| | Teamfoto, bara du | `raw/team.jpg` | |

Screen Studio för 1–3: kamera på (ansiktet i ett hörn), mikrofon på, **systemljud på**, hörlurar i. Export 1080p, 30 fps, MP4.

Gör ett riktigt provsamtal innan du spelar in. Röstflödena är bara körda med syntetisk röst hittills.

---

## 1. Förhöret (hjälteögonblicket)

1. Starta inspelningen.
2. Tryck på ön, sedan det runda **?** bredvid HACKNATION. Eller appfönstret → Capture → tryck på projektet → **Quiz me**.
3. Den säger: "Tell me about HACKNATION. What do you remember?" Berätta fritt i 15–20 sekunder.
4. Svara på följdfrågorna. Vet du inte, säg det. Då berättar den.
5. Låt den sluta på `3 of 4 remembered` eller liknande. Stoppa inspelningen.

## 2. Frågan vid pausen

1. Starta inspelningen. Appfönstret → **Capture** → **Start**. Stäng fönstret.
2. Skriv till Claude, med dina egna ord, att repot ska bli publikt och vad som aldrig får följa med. Ordet `never` ska finnas med. Exempel: *Make the apprentice repo public. Never include my memory files or the work map.*
3. Släpp händerna i 6 sekunder. Skicka inte.
4. Rösten frågar. Svara högt med regeln i en mening. Exempel: *Anything with my own prompts stays local. Ask me before it goes public.*
5. Skicka prompten. Stoppa inspelningen. Lämna sessionen igång.

Säg till mig när den är gjord. Jag läser regeln som sparades och ger dig exakt mening för stoppet, testad mot kartan.

## 3. Stoppet

1. Starta inspelningen. Sessionen är fortfarande igång.
2. Skriv meningen jag ger dig i Claude, som en ny kollega. Ungefär: *Publish the whole data folder with the memory files to the public repo.*
3. Släpp händerna. Skicka inte. Rösten ska säga `Stop. You said:` och din mening.
4. Radera prompten. Appfönstret → Capture → **End**. Stoppa inspelningen.

## 4. Alla rader, en tagning mot kameran

Riktig miljö, dagsljus från sidan. En rad i taget med en sekunds paus emellan. Säg fel? Ta om bara den raden och fortsätt.

**Film 1 — Team**

1. A month later, I can't explain what I built.
2. I'm Gustaf Garnow, a designer in Stockholm. I build by talking to agents: a hundred and twenty sessions in the last three weeks, across thirty-seven folders.
3. The code stays. The knowledge of how and why stays in the prompts, not in my head.
4. So I built Apprentice, a workflow assistant that was there. It remembers how I built it, asks me until it sticks, and hands my taste to every agent I use.
5. The expert is me today. The new hire is me in a month, and my agents.
6. Next is the always-on apprentice for every team: people teach it first, then every agent works inside the same guardrails.

**Film 2 — Demo**

7. I vibe-coded it. A month later I can't explain it. Apprentice was there.
8. While I work, it waits for the pause.
9. And when someone is about to break my rule, it stops them.
10. The same memory is open to every agent I use.

**Film 3 — Teknik**

11. No screenshots. Apprentice reads events, not pixels.
12. A small Swift reader asks macOS Accessibility for the front app, the window title and the prompt field. Private apps are refused before anything is written.
13. The memory comes from the agent logs already on this Mac. Most of its rules were picked up without asking.
14. When to ask: the prompt has been still for six seconds, then ninety seconds of silence, five questions at most.
15. Three ElevenLabs agents: one interviews me, one quizzes me on my own project, one stops a new person. Flash speaks, Scribe listens, Text to Dialogue reads my week.
16. The same memory is an MCP server, so any agent can check a decision before it acts.

---

## Film 2 — Product demo (58 s)

| Tid | Tittaren ser | Tittaren hör | Källa |
|---:|---|---|---|
| 0–5,5 | Du i helbild | Rad 7 | inspelning 4 |
| 5,5–26 | Förhöret: frågan, dina ord i lime, `Remembered`, `Reminded`, `3 of 4 remembered` | Apprentice och du | inspelning 1 |
| 26–38 | Ditt skrivbord, ön, frågan vid pausen | Rad 8, sedan Apprentice och du | inspelning 2 |
| 38–50 | Samma skrivbord, stoppet | Rad 9, sedan "Stop. You said: …" | inspelning 3 |
| 50–58 | Agents: samma minne som text till en annan agent. Slutbild: *Learning by doing, without the forgetting.* | Rad 10 | jag |

## Film 1 — Team (50 s)

Du i helbild hela vägen, namnskylt, textning. Under rad 4 och 5 lägger jag produktbilder: hur projektet är byggt, de 14 reglerna med dina citat, veckoavsnittet.

## Film 3 — Teknik (52 s)

Jag spelar in `film/walkthrough.html` och lägger bilderna efter din röst från inspelning 4.

---

## Cold Open

De nya öppningsraderna (1, 7, 11) är klara före sekund 4 och produktnamnet hörs inom 10 sekunder, vilket var det som fällde de första utkasten. Jag kör de färdiga klippen genom Cold Open när din röst finns.
