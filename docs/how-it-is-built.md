# How it is put together

Mason is a small native shell around a local server. The shell is Swift, the server is Node with no dependencies, and every screen is a web page the shell shows in its own windows. Nothing opens in a browser.

## The parts

| Part | Where | What it does |
|---|---|---|
| **The reader** | [`native/ApprenticeReader.swift`](../apprentice/native/ApprenticeReader.swift) | Asks macOS Accessibility for the app in front, the window title, the site of a tab and the prompt field. Refuses private apps before it looks at the window. |
| **The app** | [`native/ApprenticeApp.swift`](../apprentice/native/ApprenticeApp.swift) | The island, the panel and the app window. Starts the server and stops it. |
| **The collector** | [`src/collector.mjs`](../apprentice/src/collector.mjs) | Turns what the reader saw into events. Events, never pixels. |
| **The agent logs** | [`src/projects.mjs`](../apprentice/src/projects.mjs), [`src/others.mjs`](../apprentice/src/others.mjs) | Read the sessions of Claude Code, Codex and Grok into projects. |
| **The memory** | [`src/memory.mjs`](../apprentice/src/memory.mjs) | Folds every session of a project into one memory: what it is, how it is put together, where it was left. |
| **The Work Map** | [`src/store.mjs`](../apprentice/src/store.mjs) | Decisions and rules in your own words, each with its source. |
| **The server** | [`src/server.mjs`](../apprentice/src/server.mjs) | Serves the pages and their data to this Mac only. [`src/guard.mjs`](../apprentice/src/guard.mjs) decides who is answered: Mason's own pages, and who holds the key of this start. |
| **The model** | [`src/llm.mjs`](../apprentice/src/llm.mjs) | One function, `askModel`. Everything that needs a model goes through it, so the model can be changed. |
| **The voice** | [`src/voice.mjs`](../apprentice/src/voice.mjs), [`src/agent.mjs`](../apprentice/src/agent.mjs) | ElevenLabs speech, dictation and the three calling agents. |
| **The hand-over** | [`src/handover.mjs`](../apprentice/src/handover.mjs) | Makes the prompt that carries a rule to an agent. Mason writes no rule itself. |
| **MCP** | [`src/mcp-handler.mjs`](../apprentice/src/mcp-handler.mjs) | The memory as tools for any agent. |
| **The pages** | [`public/`](../apprentice/public) | Plain HTML, CSS and JavaScript. No framework, no build step. |

## How a day flows through it

1. The reader reports a change: another window, a prompt.
2. The collector writes it as an event, redacted, unless the app or the title is private.
3. The agent logs say which project a window belongs to and what was said there.
4. The memory is rebuilt for a project an hour after you leave it, through `askModel`, or from your own words without a model.
5. The server gives the island, the panel and the window what they show.
6. An agent asks over MCP and gets the same memory.

## What needs a model, and what does not

A model is asked for summaries, the recap script, and three readings of your repeated rules. Watching, counting, the look back, Flow, Days, Workflow and the nudges are plain code, and so are the checks on a stranger's workflow file.

Keep it that way: a new feature goes through `askModel` and works, in some plain form, without it.

## Principles the code holds to

- **Events, not pixels.** No screen-capture and no keyboard API is linked anywhere. A test fails if one is.
- **Refused before it is written.** A private surface is turned away before an event exists.
- **Mason writes no rule.** It proposes, and hands the rule to an agent as a prompt a person reads and sends. Nothing is written outside its own folder.
- **Anything that reads or sends something new gets a switch in Settings,** and a line in [What it reads, sends and keeps](privacy.md).
- **No dependencies.** The server runs on Node alone. There is nothing to install and nothing to audit but this repository.
- **Read in three seconds.** A screen is one figure or a few words in large type, with the detail one press away.

To work on it, see [Contributing](../CONTRIBUTING.md).
