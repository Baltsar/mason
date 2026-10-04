# Apprentice: brief for the demo videos

Written 4 Oct, about 10:15, by the session that builds the app. It adds to `SHOOT.md`; the three films stay. What is new: a sharper story, three new things in the product, and a few lines in `SHOOT.md` that are no longer true (last section).

## The problem

Say it in these words or close to them.

- I build by talking to agents. The code stays. The knowledge of how and why stays in the prompts, not in my head.
- A month later I know a few keywords. The answer is somewhere in one of 120 agent sessions.
- **Pitch:** "I vibe-coded it. A month later I can't explain it. Apprentice was there: it remembers how I built it, asks me until it sticks, and hands my taste to every agent I use."
- **Tagline:** "Learning by doing, without the forgetting."
- **What it is, in a phrase:** a workflow assistant that was there.

It is a win on both sides: I get my own project back, and my agents get my taste without me repeating it.

## How it fits the challenge

The same three modules, with one twist: **the expert is me today; the new hire is me in a month, and my agents.**

| Module | What Apprentice does |
|---|---|
| Capture | Watches real work as events (no screenshots) and asks at a pause, inside a capture session. |
| Map | My decisions and rules in my own words. 12 of the 14 rules were picked up without asking, from corrections I repeated to my agents. |
| Teach | The recall call asks me about my own project. The tutor call stops a new person. Any agent loads the same memory over MCP. |

## The three scenarios, ranked

1. **"How did I build this a month ago?"** The problem. Lead with it.
2. **"My agents know my taste."** The payoff on the agent side.
3. **"What did I do today? 97% work."** The hook. An opening image, not the pitch: time trackers already exist.

## Proof moments in the app

| # | Moment | Where | What is seen and heard |
|---|---|---|---|
| 1 | **Recall call** (the hero) | Panel: the round **?** next to the project. Or app window → Capture → press a project → **Quiz me** | "Tell me about HACKNATION. What do you remember?" I talk. Lime chips: `Remembered · native Mac app`. Then: "You also built a demo video pipeline. Why did you build that instead of just recording your screen?" If I do not know it tells me, and a violet chip says `Reminded · …`. Ends on `3 of 4 remembered`. |
| 2 | How it is built | App window → Capture → press a project | Four lines naming real files, where I left off, what is open, what I keep saying ×N. |
| 3 | Rules nobody asked for | App window → Map | 14 guardrails, each with my own quote. |
| 4 | The question at the pause | `SHOOT.md` clip 1, unchanged | |
| 5 | The stop | `SHOOT.md` clip 2, unchanged. Also as a voice call: Teach → **Tutor call** | "Gustaf would stop here. Why do you think?" then my quote. |
| 6 | The debrief call | `SHOOT.md` clip 3, **dialogue changed**, see last section | |
| 7 | The island and the eye | Menu bar | Left of the notch: the mark and the work share. Right of the notch: the eye. It blinks while it watches, sends one ripple when it takes in a new window or prompt, turns while it writes a summary, is a closed line when private. |
| 8 | It shows that it hears you | Any call | A ring around the microphone moves with my voice; one word says `Hearing you` or `Your turn`; my words appear in lime. |
| 9 | The week as a podcast | App window → Recap → Play | Two voices read my week as a news bulletin, 2:13, with the line being read on screen. |
| 10 | The same memory for every agent | App window → Agents → **How was it built?** or **Guardrails an agent can load**. Any MCP client can also call `check_decision`. | The project's memory, or my rules, as the text another agent receives. |

Quotes that are real and good on screen:
- "Ja sluta fråga publicera" (BITMAGIC HACKATHON, said twice) became the rule *Publicera utan att fråga mig*.
- "de ska kännas simple as fuck" (OPENSVERIGE, said twice).
- "vi måste veta om du tar emot ljud eller inte" was said to an agent this morning. An hour later it was a rule in the map: *Needs clear feedback when app is listening*.

## Numbers, measured today

- 120 Claude Code sessions in the last 21 days, across 37 project folders.
- This week (28 Sep to 4 Oct): 8 projects, 174 prompts, about 30 hours of agent activity, busiest day Thursday (45 prompts), latest prompt of a night Wednesday 03:13.
- Work Map: 17 steps, 14 guardrails, 12 of them picked up without asking, from 6 projects.
- Today: 97% work.
- This week's episode: "Rematch Broken, Voices Loading", 2:13.

The hours are minutes in which the agent logs were active, not time at the screen.

## ElevenLabs in the build

- **Agents:** three of them. Debrief (interviews me), tutor (stops a new person), recall (asks me about my own project).
- **Scribe v2 Realtime:** spoken answers and dictation, push-to-talk.
- **Text to Speech, Flash v2.5:** spoken questions, "where you left off", today's recap.
- **Text to Dialogue, v3:** the weekly episode, two voices in one take.

## Do not claim

- Not "the ultimate learning tool". The tagline above is the claim.
- It does not read ChatGPT or claude.ai chats, and Cursor gives time but no memory. The memory is built from the Claude Code logs on this Mac.
- It takes no screenshots and logs no keystrokes. It reads the front app, the window title and the prompt field.
- In the background it never asks anything. Questions come only inside a capture session.
- "How it is built" comes from what the agents reported and the names of the files they changed. File contents are not read, and a line can be wrong. Read the lines before showing them.

## Not verified yet

- Every voice flow has been run end to end only with a synthetic voice in a browser, not with Gustaf's microphone in the app's own panel. Do one real call before recording. Use headphones.
- The island with a crowded menu bar (a browser in front) has only been seen in a test build.

## Lines in SHOOT.md that are no longer true

- **Teach-back.** It no longer asks "Is that how it works?" and waits for "Yes." It ends on **"What did I get wrong?"** Answer "Nothing, that's right." It says "Noted." and hangs up. This touches film 2 (row 20–32), clip 3, and film 3 line 4 ("It is done when I say yes").
- **How the agents talk.** No greeting, no praise, no farewell, nothing a yes or a no answers. The debrief opens with "I watched you move between A and B today. What were you trying to get done?"
- **Film 3 line 4.** There are three agents now, not one, and Text to Dialogue for the episode.
- **Ending a capture session.** End is in the app window (Capture), not in the island's panel.
- **The island looks different since about 09:45 today.** Footage from before that (`raw/test.mp4`, `out/test-demo.mp4`) shows the old two-wing island and no eye.

## A cut for film 2, as a suggestion

| Time | Seen | Heard |
|---:|---|---|
| 0–6 | A month-old project. The island, the panel: the project and where it was left. | "A month later. A hundred and twenty sessions. How did I build this?" |
| 6–26 | The recall call. | "Tell me about … What do you remember?" I talk. "You also did this. What did you decide there?" |
| 26–38 | Clip 1: the question at the pause, my rule saved in my words. | Apprentice asks, I answer. |
| 38–50 | Clip 2: someone breaks the rule and is stopped. | "Stop. You said: …" |
| 50–58 | The same memory answered to another agent. End card. | "The same memory is open to every agent I use." |
