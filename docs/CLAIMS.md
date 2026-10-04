# What the films say, and where it is true

Every claim in the technical walkthrough, with the code it rests on and the test that checks it. Run the tests with `cd apprentice && npm test`: the file is [`test/claims.test.mjs`](../apprentice/test/claims.test.mjs).

| The film says | Where it is true | Checked by |
|---|---|---|
| **Events, not pixels.** A native Mac app; Accessibility gives the app, the window title and the prompt. 0 screenshots, 0 keystrokes. | The reader is [`native/ApprenticeReader.swift`](../apprentice/native/ApprenticeReader.swift): it asks macOS Accessibility and nothing else. Each change is stored as an event marked `event-not-image` in [`src/collector.mjs`](../apprentice/src/collector.mjs#L254). No screen-capture or keyboard API is linked anywhere in `native/` or `src/`. | `events, not pixels` |
| **Refused before it is written.** Private apps are refused. | The list of refused apps and title words is at the top of [`src/collector.mjs`](../apprentice/src/collector.mjs#L12). The reader turns a refused app away [before it looks at the window](../apprentice/native/ApprenticeReader.swift#L45), and a private title [before anything is returned](../apprentice/native/ApprenticeReader.swift#L73). The count on screen ("refused today") is [`privateRefusals`](../apprentice/src/collector.mjs#L321): counted, never named. Since the films, chat and mail can be kept by name and time when that is switched on in Settings; it is off until asked for, and password managers, banking, health and private windows are never named. | `refused before it is written`; `chat and mail are named only when that is switched on` in `chats.test.mjs` |
| **Secrets are redacted.** | [`src/redact.mjs`](../apprentice/src/redact.mjs#L12) runs before an excerpt is stored: mail addresses, passwords, keys, tokens. | `redacts local secrets before persistence` in `core.test.mjs` |
| **The memory is stored on this Mac.** | Everything is written under `apprentice/data/`, set in [`src/store.mjs`](../apprentice/src/store.mjs#L9), which is not in this repository. The same memory is written as plain Markdown notes in `apprentice/wiki/` ([`src/wiki.mjs`](../apprentice/src/wiki.mjs)), which opens as an Obsidian vault. The server [listens on 127.0.0.1 only](../apprentice/src/server.mjs#L724). | `the memory is served to this Mac only`, and `the memory is also a folder of linked Markdown notes` in `vault.test.mjs` |
| **He decides what I see.** | Go private stops all capture at once (`/api/control` in `src/server.mjs`); the island's eye closes. Sound, summaries, the ElevenLabs voice and the name are under Settings ([`src/settings.mjs`](../apprentice/src/settings.mjs)). | `a setting is kept` in `settings.test.mjs` |
| **It waits for the pause.** Six seconds still, then ninety seconds quiet. | [`limits()` in `src/question-engine.mjs`](../apprentice/src/question-engine.mjs#L17): pause 6000 ms, cooldown 90 000 ms, five questions at most in a session. | `it waits for the pause`, and `asks a guardrail question only after a pause` in `core.test.mjs` |
| **One memory, every agent.** The rules come out of the agent logs. | [`src/projects.mjs`](../apprentice/src/projects.mjs) reads the Claude Code logs; [`src/memory.mjs`](../apprentice/src/memory.mjs#L143) turns a correction given twice into a rule, and [keeps it only when the quote is really something that was said](../apprentice/src/memory.mjs#L85). | `the rules come out of the agent logs` |
| **Three ElevenLabs agents.** | Debrief, tutor and recall in [`src/agent.mjs`](../apprentice/src/agent.mjs#L178), each with its own prompt and tools. | `three ElevenLabs agents` |
| **MCP.** | [`src/mcp-handler.mjs`](../apprentice/src/mcp-handler.mjs#L7): eight tools, among them `how_was_it_built`, `guardrails_for_agents` and `check_decision`. | `mcp.test.mjs`, three tests |
| **Work today in per cent.** | [`aggregateActivity` in `src/activity.mjs`](../apprentice/src/activity.mjs): work, social and other always sum to 100; idle time over a minute is left out; time inside a project counts as work. | The activity tests in `core.test.mjs` |

## What it cannot do yet

The film says these too. They are true.

| The film says | In the code |
|---|---|
| **Mac only.** | The reader and the island are Swift, AppKit and macOS Accessibility. |
| **Claude Code logs only.** | [`src/projects.mjs`](../apprentice/src/projects.mjs) reads `~/.claude/projects`. Cursor gives a project its time, not its memory. Chats in ChatGPT or on claude.ai are not on disk and are not read. |
| **The voice is in the cloud.** | Speech, the calls and dictation go to ElevenLabs ([`src/voice.mjs`](../apprentice/src/voice.mjs#L76), [`src/agent.mjs`](../apprentice/src/agent.mjs)). Summaries go through the Claude CLI on your own login ([`src/llm.mjs`](../apprentice/src/llm.mjs#L42)). The memory itself stays on the Mac. Both can be switched off in Settings ([`src/settings.mjs`](../apprentice/src/settings.mjs)); then nothing leaves it. |
| **It does not ask in the background yet.** | Off by default in [`src/store.mjs`](../apprentice/src/store.mjs): questions are asked only inside a capture session. |

## Every jump, every decision

| | Today | Next |
|---|---|---|
| Every jump between apps | Each change of app, window and project is an event, and moves between projects are counted ([`src/projects.mjs`](../apprentice/src/projects.mjs#L302)). In a session a move can be asked about ([`rankSwitch`](../apprentice/src/question-engine.mjs#L74)). | The same in the background, at a real pause. |
| Every decision | Decisions and rules are kept from the debrief call, from live answers and from corrections repeated to agents. | A decision it has not seen before is noticed and asked about once. |
| Saying how it was built | The recall call asks what you remember and fills in what you left out; `how_was_it_built` gives the same memory to any agent. | The memory follows the project, not the Mac. |

## Since the films

Added after the submission, which is the tag `hack-nation-7`.

| What | Where | Checked by |
|---|---|---|
| **Flow.** How a day moved between tools: the jumps, the habits between two tools, the longest unbroken stretch. | [`src/flow.mjs`](../apprentice/src/flow.mjs). A glance under five seconds, a pause in the same tool and a break of fifteen minutes are not jumps. A site is known by the name in its window title. | `flow.test.mjs`, four tests |
| **Days.** Every day worked and its projects, back to the first day of each. | [`src/days.mjs`](../apprentice/src/days.mjs), from the agents' logs, kept in `data/days.json` so the days outlast the logs. | `days.test.mjs`, three tests |
| **Any model.** The summaries can be written by any model, one on the Mac included. | [`src/llm.mjs`](../apprentice/src/llm.mjs#L85) | `llm.test.mjs`, two tests |
| **A switch on everything read and sent.** | Agent logs, chat and mail by name, summaries and ElevenLabs in [`src/settings.mjs`](../apprentice/src/settings.mjs). | `settings.test.mjs`, three tests |
| **The tools' own icons.** | [`native/MasonIcons.swift`](../apprentice/native/MasonIcons.swift) asks macOS for an app's icon by its name and reads nothing else. | |

The numbers on screen in the film (87% work, 50 refused) were read from the running app on 4 October 2026 at 14:35. They are that day's own data and are not in this repository.
