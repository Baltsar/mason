# What it reads, sends and keeps

Mason watches the work, not the screen. The memory is built on your Mac and stays there. Nothing leaves the Mac until you switch on something that needs to, and each of those has its own switch in Settings.

## In short

| | |
|---|---|
| **No screenshots, no keystrokes.** | It reads events through macOS Accessibility: which app, which window, which site. Never pixels. |
| **No account, no server of ours.** | There is nothing to sign up for. Mason has no backend. |
| **Four things can leave the Mac.** | Summaries to a model, speech to ElevenLabs, a request for a site's icon, and a look for a new version. Each has a switch. With all four off, nothing leaves. |
| **Nothing is written outside its folder.** | A rule reaches an agent only as a prompt you read and send yourself. |

## What it reads

| | How | Kept |
|---|---|---|
| **The screen** | macOS Accessibility, which you grant once: the app in front, the window title, the site of a browser's front tab and the text of a prompt field. | Events, with redacted excerpts. Of an address only the host (`figma.com`), never the path or the query. Never pictures, never keystrokes. |
| **Agent logs** | Claude Code, Codex and Grok write every session to your home folder (`~/.claude/projects`, `~/.codex/sessions`, `~/.grok/sessions`). Mason reads what you said, the names of the files the agents changed, what they reported, and the count of tokens each answer took. Of Cursor it reads which folder each workspace is and what you asked in it, from the small store Cursor keeps for each workspace, for reading only; not Cursor's answers, and not what they took. | Redacted excerpts, file names, minutes per day. **Agent logs** in Settings switches it off. |
| **Chat and mail** | Not read. Counted as a refusal. With **Chat and mail by name** switched on, the name of the app or site and the time spent there are kept, so Flow shows every jump. | Name and time only, never a title. |

File contents are never read. What Mason knows about how a project is put together comes from your prompts, what the agents reported and the names of the files they changed.

## What it never takes

- Password managers, mail, chat, banking, health and private-browsing windows are refused before an event is written. They are counted, never named.
- Secrets are redacted before an excerpt is stored: mail addresses, passwords, keys, tokens.
- Chats in ChatGPT or on claude.ai are not on disk and are not read.

The list of refused apps and title words is at the top of [`collector.mjs`](../apprentice/src/collector.mjs), and the redaction is [`redact.mjs`](../apprentice/src/redact.mjs).

## What leaves the Mac

Settings groups its switches by this, under **Leaves this Mac**.

| Switch | When it is on | When it is off |
|---|---|---|
| **Summaries** | Redacted excerpts of your prompts go to a model, which writes the summary of a project. By default that is your own Claude login, the same place the prompts already went. It can be a model on your Mac. | The memory is your own last prompts, word for word. Nothing is proposed. |
| **Voice** | With an ElevenLabs key: the text to be spoken, the audio of an answer while the microphone is open, and for a call the day's summary (project names, minutes, sites outside the projects without their titles, and redacted excerpts of your prompts). | Mason speaks with the Mac's own voice, answers are typed, there are no calls, and nothing is sent or spent. |
| **Logos from the web** | Mason asks each site you used for its own icon, once, over https. Off until you switch it on. | A site shows a lettered tile. |
| **New versions** | Once a day Mason asks GitHub for the latest release of its own repository and compares the number with its own. It sends nothing of yours and installs nothing. | Not looked for. |

With a model on the Mac, or Summaries off, and the other three off, nothing leaves the Mac. See [Models and voice](models-and-voice.md).

## Where it is kept

Inside the folder you cloned, and not in the repository:

| Folder | What |
|---|---|
| `apprentice/data/` | The memory: events, the Work Map, settings, what was shared. |
| `apprentice/wiki/` | The same memory as plain Markdown notes with links between them: one note per project, your rules, the Work Map. Open it in Obsidian or any editor. |

Settings → **Kept on this Mac** opens both in Finder. **Forget** empties what Find has read. Deleting the two folders deletes the memory.

## What it writes outside its own folder

Nothing. Mason writes no rule anywhere.

A proposal, like a rule from someone else's workflow, is handed to an agent you choose: Claude Code, Codex or Cursor opens with a prompt that is ready and not sent, and **Copy prompt** serves any other. You read it and press Enter, and the agent shows the change before it saves: one line under `## Learned by Mason` in each rules file that exists (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.grok/AGENTS.md`).

Mason reads those files to see when a rule stands there. It is then listed under **In your agents' rules** in Settings, with the agents that hold it. See [Rules for every agent](agents-and-mcp.md#rules-for-every-agent).

## Who the local server answers

Mason's windows talk to a server on your Mac. It listens on `127.0.0.1` and nowhere else.

A page in a browser is on this Mac too, and a browser lets any page send a request to an address on the same machine. So a request is answered only when it was addressed to this Mac, and, when a browser says which page sent it, only when that page is Mason's own. A link someone sends cannot switch a setting, read the memory or have a rule written.

That stops a page and nothing else, so there is a key as well, made anew at every start. Mason's own windows and the island hold it, and an agent holds it when you give it to one. The pages themselves are served without it, since they say nothing about you. Everything else (the memory, every setting, every answer, `/mcp`) is refused to who does not hold the key.

What the key does not stop: a program that runs as you and may read your files. It can read the memory on disk without asking the server at all. So the words of a proposal are still checked like a stranger's, nothing a caller sends is spoken or run, and the last step is always a prompt a person sends.

## Check it yourself

Every claim above rests on code and a test. [What the films say, and where it is true](CLAIMS.md) ties each one to the line it rests on, and `npm test` runs the checks: no screen-capture or keyboard API is linked anywhere in the product, a private app is turned away before its window is looked at, and the server listens on this Mac only.

Found a way around any of it? See [Security](../SECURITY.md).
