<img src="apprentice/public/brand/mason-mark.png" width="96" align="right" alt="" />

# Mason

Learning by doing, without the forgetting.

I vibe-coded it. A month later I can't explain it. The code stays, but the knowledge of how and why stays in the prompts, somewhere in one of 120 agent sessions.

Mason is a local macOS assistant that was there. It remembers how a project was built, asks me about it until it sticks, and hands my taste to every agent I use.

Built solo by Gustaf Garnow for Challenge 01, The AI Apprentice, at the Hack-Nation 7th Global AI Hackathon.

Live page with the pitch film: https://mason-demo-eight.vercel.app

![The island in the menu bar, today in large figures, a question at a pause, and Mason asking what you remember](docs/screens.png)

## What it does

| | |
|---|---|
| **Watches the work, not the screen** | It reads the front app, the window title and the prompt field through macOS Accessibility. No screenshots, no keystrokes. In the background it never asks anything. |
| **Remembers how it was built** | Every Claude Code session of a project folder is folded into one memory: what it is, how it is put together, where it was left, what is still open. |
| **Picks up your rules without asking** | A correction you gave an agent twice is a rule you never wrote down. It lands in the Work Map with your own words as evidence. |
| **Talks, when you take the call** | Three ElevenLabs agents: a debrief about today, a recall call that asks what you still know about your own project, and a tutor that stops a new person before they break a rule. |
| **Keeps it as files you own** | The memory is also a folder of plain Markdown notes with links between them: projects, rules and the Work Map. Open `apprentice/wiki/` in Obsidian or any editor. |
| **Hands it to every agent** | The same memory is an MCP server: `how_was_it_built`, `guardrails_for_agents`, `check_decision`. |

ElevenLabs in the build: Agents (three), Scribe v2 Realtime, Text to Speech (Flash v2.5) and Text to Dialogue (v3) for a weekly two-voice recap.

## Against the brief

The challenge asks for three modules and five answers. One twist: the expert is me today, and the new hire is me in a month, and every agent I work with.

| The brief requires | In Mason | Where |
|---|---|---|
| **Capture.** At least three questions during a real task, each at a natural pause and about what is on screen, one of them about a guardrail. | In a capture session Mason reads the prompt being typed and asks aloud once it has been still for six seconds: at most five questions, at least ninety seconds apart. A prompt that sets a limit gets the guardrail question. Asked with ElevenLabs speech, answered through Scribe v2 Realtime. | App window → Capture → Start |
| **Map.** A spoken debrief with follow-up questions that ends in a teach-back the expert confirms. Every step linked to a screen moment and the expert's own words. | An ElevenLabs agent takes the call, asks about what the session left open, saves each answer as a step while you talk, explains the whole thing back and waits for you to confirm it. Each step keeps its moment (time, app, window) and your quote. | Panel → the phone. App window → Map |
| **Teach.** A new hire works a case the expert never showed. The tutor catches a wrong decision before it is saved, explains it with the expert's reasoning, and shows what was mastered. | A tutor agent that holds only your rules: "Gustaf would stop here. Why do you think?", then your own words. In a session the same stop is spoken while the wrong prompt is still unsent. Stopped, then right the second time, counts as mastered. | App window → Teach → Tutor call |

The Apprentice Test:

1. **When to ask.** Never in the background. In a session: when the prompt text has been still for six seconds, or the hands have been still since a move between apps, then ninety seconds of quiet. The debrief is offered at a break, never started by itself.
2. **What to ask.** The agent is given the projects, the moves between them, the detours and your own prompts, and is told never to ask what the screen already answers.
3. **When it has understood.** It has explained the process back and you confirmed it. A correction is saved and said again first.
4. **Whether the new hire learned.** Teach records what stopped them and what they got right on the second try.
5. **Trust.** Go private stops everything at once. Password managers, mail, chat, banking and private windows are refused before anything is written, and counted but never named. Text is redacted before it is stored. Events, not screenshots.

Stretch goals met: **agent-ready guardrails** (the Work Map is an MCP server) and **any language** (I explain in Swedish; the tutor teaches in English and quotes me as I said it).

**The moonshot** is the always-on apprentice for people who build with agents. Mason already runs all day without sessions and builds its memory from work that happens anyway. Next it notices a decision it has not seen before and asks one question at the next real pause, and the memory follows the project instead of the Mac, so a teammate's agent starts where mine left off.

Every claim made in the films is tied to the code and a test in [docs/CLAIMS.md](docs/CLAIMS.md).

## How it is put together

```mermaid
flowchart LR
  subgraph mac["On your Mac"]
    reader["Reader, Swift<br/>front app, window, prompt"] --> collector["Collector<br/>events, never pixels"]
    logs["Claude Code logs<br/>prompts, files changed, reports"] --> memory["Project memory<br/>how it was built"]
    collector --> server["Local server<br/>Node, no dependencies"]
    memory --> server
    server --> map["Work Map<br/>decisions and rules, your words"]
    server --> island["Island, panel, window<br/>Swift and WebKit"]
  end
  server <--> eleven["ElevenLabs<br/>Agents, Scribe, TTS, Dialogue"]
  memory <--> claude["Claude CLI<br/>summaries, your own login"]
  map --> mcp["MCP server<br/>any agent"]
```

Nothing leaves the Mac until a voice is used: then the words to be spoken, the audio of an answer, and for a call a summary of the day. Summaries go through your own Claude login, the same place the prompts already went.

## Where things are

| Folder | What |
|---|---|
| [`apprentice/`](apprentice/) | The app (the folder keeps its first name): native macOS island, local server, ElevenLabs voice, MCP server. Start with its [README](apprentice/README.md). |
| [`film/`](film/) | How the three submission films were made: the app window is driven and recorded headlessly, then cut and captioned by script. |
| [`site/`](site/) | The public page. |

## Run it

```bash
cd apprentice
cp .env.local.example .env.local   # optional: an ElevenLabs key turns on the voice
npm run build:reader               # builds Mason.app with swiftc
open Mason.app
```

macOS 13 or later, Node 18 or later, Xcode command line tools. No packages to install: the server has no dependencies.

Press the island in the menu bar. The first time it asks for Accessibility, which is how it sees which app and window you are in. Name, sound and the rest are under the gear in the app window.

```bash
npm test                           # 30 tests, no network, no data of yours needed
```

## Limits

- The memory is stored on the Mac, but the voice is not: speech, calls and dictation go through ElevenLabs, and summaries through your Claude login. Both have a switch in Settings. With ElevenLabs and summaries switched off, nothing leaves the Mac: Mason then speaks with the Mac's own voice, there are no calls, and the memory is your own words.
- macOS only. The memory is built from Claude Code logs; chats in ChatGPT or on claude.ai are not on disk and are not read.
- "How it is put together" comes from what the agents reported and the names of the files they changed. File contents are never read, and a line can be wrong where an agent was.
- Live questions in a session and the written check in Teach are deterministic. The calls judge by meaning.
- More in the app's [README](apprentice/README.md#boundaries-of-this-slice).

## What is not in this repository

The memory. `apprentice/data/` and `apprentice/wiki/` are built on your own Mac from your own agent logs, and they stay there.
