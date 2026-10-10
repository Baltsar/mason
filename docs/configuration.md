# Settings and configuration

Nothing here is needed to get started: every setting has a default that works. This page lists all of them. A test compares it with the code on every change, so a switch or a variable that is not on this page fails the build.

## Settings

Under the gear in the app window. Mason calls you by the first name on this Mac's account until you type another under **Name**.

| Switch | Default | What it does |
|---|---|---|
| **Summaries** | On | A model writes the summary of each project and words the proposals. Off: the memory is your own last prompts. |
| **Voice** | On | ElevenLabs speaks, listens and calls. Shown as a switch once there is a key. Off: the Mac's own voice, typed answers, no calls. |
| **Logos from the web** | Off | Asks each site you used for its own icon, once. Off: lettered tiles. |
| **New versions** | On | Asks GitHub once a day whether a newer release is out, and says so here and on the island. Installs nothing. |
| **Agent logs** | On | Reads the logs of Claude Code, Codex and Grok. Off: Mason knows time, not what was built. |
| **What you said, by meaning** | Off | An embedding model on this Mac places your prompts by meaning, for Find. |
| **Chat and mail by name** | Off | Keeps the name of a chat or mail app and the time spent there. Off: counted, never named. |
| **Sound** | On | Mason speaks. Off: silent. |
| **Answer ready** | On | A small card drops from the menu bar when Claude Code, Codex or Grok has finished an answer and you are somewhere else: the project, the agent, how long it worked, and a press that brings its app forward. It leaves by itself after nine seconds, takes no keyboard, and is not shown for an answer you were waiting in front of. Several at once come as one card, and after time away from the Mac there is one card for all of them. A soft note is played with it unless **Sound** is off. Cursor keeps no record of when it finished, so its answers are not told of. |
| **A word on the island** | On | Nudges on the island when an answer has waited. |
| **Island by the notch** | On | Mason sits in the menu bar as the island beside the notch, showing the day. Off, it is one icon among the others on the right, with a dot when there is something to come back to. |
| **Liquid glass** | Off | A second look to try: glass panels over the desktop. |

The first four are grouped as **Leaves this Mac**, the next three as **Stays on this Mac**. What each one sends or keeps is in [What it reads, sends and keeps](privacy.md).

Also in Settings: **Screen** shows whether Mason has Accessibility and offers **Fix access** when it has not, **In your agents' rules** lists the rules that stand in your agents' rules files, with the agents that hold each, and **Kept on this Mac** opens the memory and the notes in Finder.

## In .env.local

`apprentice/.env.local` is read at start. It is local and ignored by git; `cp .env.local.example .env.local` gives you a file to fill in. Only the names in this table are read from it. A variable that is already set in the environment wins.

| Variable | Default | What it sets |
|---|---|---|
| `ELEVENLABS_API_KEY` | none | Your ElevenLabs key. Turns on the voice. |
| `ELEVENLABS_VOICE_ID` | A premade voice | Another voice for speech and the calls. |
| `ELEVENLABS_MODEL_ID` | `eleven_flash_v2_5` | The speech model. |
| `ELEVENLABS_LANGUAGE` | Detected; the calls in `en` | The language dictation listens for and the agents speak, for example `sv`. |
| `ELEVENLABS_AGENT_LLM` | `gemini-2.0-flash` | The model the three calling agents think with. |
| `APPRENTICE_LLM_URL` | none: your Claude login | An address that answers in the OpenAI chat format. That model then writes the summaries. |
| `APPRENTICE_LLM_MODEL` | `haiku` with Claude | The name of the model. |
| `APPRENTICE_LLM_KEY` | none | A key, when the provider asks for one. |
| `APPRENTICE_EMBED_URL` | none: llama.cpp on this Mac | An address that answers in the OpenAI embeddings format. |
| `APPRENTICE_EMBED_MODEL` | The `.gguf` in `data/models/` | The embedding model: a name at that address, or the path of a `.gguf` file. |
| `APPRENTICE_EMBED_KEY` | none | A key for the embeddings address. |
| `APPRENTICE_LLAMA` | Looked for | The path of `llama-server`, when it is not where Mason looks. |
| `APPRENTICE_SYSTEM_VOICE` | `Samantha` | The Mac voice used when ElevenLabs is off. |
| `PORT` | `4317` | The port of the local server. |

## In the environment

For a rehearsal, a test or a recording. These are read from the environment of the process, not from `.env.local`.

| Variable | What it does |
|---|---|
| `APPRENTICE_DATA` | Another folder for the memory. The notes are then written inside it. |
| `APPRENTICE_COLLECT` | `0`: the screen is not watched and nothing is opened in Finder. |
| `APPRENTICE_OVERLAY` | `0`: no island. |
| `APPRENTICE_MUTE` | `1`: silent. |
| `APPRENTICE_LLM` | `0`: no model is asked. The same as Summaries off. |
| `APPRENTICE_LLM_BIN` | The path of the Claude Code CLI, when it is not on the path. |
| `APPRENTICE_PODCAST_MODEL` | The model that writes the recap script. `sonnet` by default. |
| `APPRENTICE_RULES_FILE` | Another file than `~/.claude/CLAUDE.md` to read your agents' rules from. |
| `APPRENTICE_CLAUDE_DIR` | Another folder of Claude Code logs. Codex, Grok and Cursor are then read only when their folders are named too. |
| `APPRENTICE_CODEX_DIR` | Another folder of Codex sessions. |
| `APPRENTICE_GROK_DIR` | Another folder of Grok sessions. |
| `APPRENTICE_CURSOR_DIR` | Another folder of Cursor workspaces. |
| `APPRENTICE_DEMO` | Shorter pauses between questions, for recording a demo. |
| `ELEVENLABS_DIALOGUE_MODEL_ID` | The model that records the recap. `eleven_v3` by default. |
| `ELEVENLABS_ANCHOR_VOICE_ID` | The first voice of the recap. |
| `ELEVENLABS_REPORTER_VOICE_ID` | The second voice of the recap. |

`APPRENTICE_URL`, `APPRENTICE_KEY`, `APPRENTICE_OPEN` and `APPRENTICE_DESKTOP_PID` are passed between the app and its own server. Leave them alone.

A rehearsal instance, with its own memory, no voice, no island and no watching. It prints the address to open, with the key of that start in it:

```bash
PORT=4318 APPRENTICE_DATA=/tmp/mason-rehearsal APPRENTICE_MUTE=1 APPRENTICE_OVERLAY=0 APPRENTICE_COLLECT=0 node src/server.mjs
```

## Commands

Run in `apprentice/`.

| Command | What it does |
|---|---|
| `npm run build:reader` | Builds `Mason.app` and its two helpers with `swiftc`. Only what changed is built again. |
| `npm start` | Builds, then runs the server in the terminal. |
| `npm test` | Every test. No network, and no data of yours is needed or touched. |
| `npm run workflows` | Checks the collection in `workflows/`. `-- build` writes its page, `-- add <file>` puts a workflow in. |
| `npm run mcp` | Runs the MCP server on standard input and output. |

## Where things are

| Path | What |
|---|---|
| `apprentice/Mason.app` | The app. Built on your Mac, not in the repository. |
| `apprentice/data/` | The memory. Not in the repository. |
| `apprentice/wiki/` | The memory as Markdown notes. Not in the repository. |
| `apprentice/.env.local` | Your keys. Not in the repository. |
| `http://127.0.0.1:4317` | The local server, on this Mac only. Everything but the pages needs the key of this start. `/mcp` is the MCP endpoint. |
