# Get started

Mason is a native Mac app for people who build with coding agents. You install it and work. There is nothing to fill in and no account to make.

## What you need

- macOS 13 or later.
- Node 18 or later.
- The Xcode command line tools (`xcode-select --install`), because the app is built on your own Mac.

There are no packages to install. The server has no dependencies.

## Install

```bash
git clone https://github.com/Baltsar/mason
cd mason/apprentice
npm run build:reader
open Mason.app
```

`npm run build:reader` builds `Mason.app` with `swiftc`. The folder is called `apprentice` because that was the first name of the project.

Drag **Mason.app** to the Dock to keep it there. It starts its own local server and stops it when it quits.

## The first minute

The window opens by itself with three short screens, one thing on each.

1. **Mason was there.** What it has already read: the days and hours of your work with agents, from the logs they keep themselves. Nothing was recorded for it.
2. **Choose what writes.** Mason counts and measures by itself; a model adds the words (what a project is, the quiz, the rules you keep repeating). The ways are shown side by side, each with what you get, what it costs, what leaves the Mac and what it takes to set up: **No model**, **Claude** (the login already on this Mac) and **On this Mac** (a model in Ollama or LM Studio, found by itself when one is running). **Check that it answers** asks the chosen model one question. Only what works on this Mac can be selected.
3. **One switch.** The one thing Mason asks macOS for: **Accessibility**, which is how it sees which app and window are in front. It says what that reads and what it never does: no screen recording, no system audio, nothing typed outside a prompt. Press **Open System Settings** and switch Mason on in the list; macOS is asked only when you press, and the screen follows by itself. **Not now** skips it.

Press **Start** and keep working. A strip of dark glass in the menu bar, left of the notch, is the island: it shows the project you are in and how much of today was work.

All of it can be changed later. Settings has **Choose what writes** under Summaries, and **The first start · See it again**. A voice is optional; see [Models and voice](models-and-voice.md).

The history is there from the first day: Mason reads the logs your coding agents already keep on the Mac, so a project you built last month is already known. What it reads is listed in [What it reads, sends and keeps](privacy.md).

macOS may also ask for the microphone. It is used for spoken answers and for calls, and for nothing else.

## A voice, if you want one

Mason works without a key. With an ElevenLabs key it speaks, listens and can call you:

```bash
cp .env.local.example .env.local
```

Put the key in `.env.local` as `ELEVENLABS_API_KEY=...` and open Mason again. See [Models and voice](models-and-voice.md).

## Update

Once a day Mason asks GitHub whether a newer release is out, and says so in Settings and once on the island. It installs nothing. To take the new version:

```bash
git pull
npm run build:reader
```

Then quit Mason and open it again. **New versions** in Settings switches the look off.

When the native part was rebuilt, macOS may still show Accessibility as on while it no longer counts, and the island says `access`. Press the island and **Fix access**. Mason forgets the old grant and asks again for this build. This happens because the app is not signed by Apple yet: macOS ties the permission to the exact build.

## Quit

Right-click the island → **Quit Mason**, or ⌘Q in the app window, or double-click **Stop Mason.command**.

## Remove it

Everything Mason keeps is inside its own folder. Delete the folder and the memory is gone.

Three things are outside it:

- **Lines in your agents' rules.** A rule you handed to an agent stands under `## Learned by Mason` in that agent's rules file (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.grok/AGENTS.md`). Your agents wrote them on your word, not Mason, so they stay until you take them out.
- **The permission.** Remove Mason from the Accessibility list in System Settings.
- **Three agents at ElevenLabs,** if you used a key: `Mason · debrief`, `Mason · tutor` and `Mason · recall` in your own ElevenLabs account. Delete them there.

## Next

- [What you see](what-you-see.md): the island, the panel and each view of the app window.
- [When something is off](troubleshooting.md).
