# When something is off

The short list of what goes wrong, and what mends it. If yours is not here, [open an issue](https://github.com/Baltsar/mason/issues/new/choose).

## The island says access

The switch in System Settings is on, and Mason still has no access. The eye is a broken orange ring.

macOS ties the Accessibility permission to the exact build it was given to. After the app has been rebuilt the switch still reads "on" but no longer counts.

Press the island and **Fix access**. Mason forgets the old grant, asks again for this build and opens the list. Switch it on there.

## There is no island

- **The app in front has very many menus.** The island takes only the free room between the menus and the notch. With none left it is not drawn. Change app and it is back.
- **The island says `Node.js not found` or `Could not start`.** The app remembers the Node it was built with. If that Node is gone (a version manager moved it), delete `Mason.app` and run `npm run build:reader` again.
- **You moved the folder.** The app also remembers where its folder is. Delete `Mason.app` and build it again.

## Summaries, proposals and the recap wait

**Summaries** in Settings says why.

- **Claude · login expired.** Open a terminal, run `claude`, then `/login`.
- **Claude not found.** The Claude Code CLI is not on this Mac. Install it, or [name another model](models-and-voice.md#the-model).
- **Another model gave no answer.** Check that the address in `APPRENTICE_LLM_URL` is running, and that the key is taken.

Without a model Mason still works: the memory is your own last prompts.

## A project is missing, or has time but no memory

A project is a folder your agents worked in. Memory comes from the logs of Claude Code, Codex and Grok. Work done only in ChatGPT, on claude.ai or in a terminal is counted as time but leaves no log to read.

Check that **Agent logs** is on in Settings.

## Find says the model or llama.cpp is not found

Find needs two things that are not in the repository: an embedding model in `apprentice/data/models/`, and llama.cpp. See [Find by meaning](models-and-voice.md#find-by-meaning).

## No voice, or a call that hears nothing

- **Voice says `No key in .env.local`.** Put `ELEVENLABS_API_KEY` in `apprentice/.env.local` and open Mason again.
- **A call says `No sound`,** with the name of the input. The microphone is open but delivers nothing: choose another input in System Settings → Sound.
- **The microphone is blocked.** The call says so, with a button to the right setting.
- **The agent keeps hearing itself.** Use headphones. **Cut in**, or the space bar, interrupts it.

## An agent is refused at /mcp, or a tab says it has no key

The local server asks for a key that is made anew at every start.

- **An agent that connects over HTTP** holds the key of an earlier start. Open **More → Agents**, copy the settings again and paste them into the agent. An agent that starts the MCP server as a command needs no key.
- **A browser tab** opened at the bare address has no key. Open the address the server printed at start, which carries it once.

## The port is taken

The local server listens on `4317`. Set `PORT` to another in `apprentice/.env.local` and open Mason again.

## Something looks wrong after an update

Quit Mason and open it again: new server code is read at start. If the native part changed, run `npm run build:reader` first, and then see [The island says access](#the-island-says-access).

## Check that the code is sound

```bash
cd apprentice
npm test
```

The tests need no network and none of your data. A failing test on a fresh clone is a bug: [report it](https://github.com/Baltsar/mason/issues/new/choose).
