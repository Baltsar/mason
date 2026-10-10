# Share and try workflows

A workflow is how someone works with coding agents, measured and not told: who they talk to, at what pace, how long an agent works on one thing, and what they tell their agents again and again. Mason reads yours out of the logs, lets you share it, and lets you try someone else's.

## Yours

Open **Workflow** in the app window. Thirty days as one card. It is there the first day, because it is read from logs that are already on the Mac.

With a model switched on, each project is placed by what it was for (building, design, writing, research, going to market) and there is a card for each. Without one there is the one card.

## Share it

**Share** makes a picture and a file, `data/share/mason-workflow-*.json`.

The file holds figures, the names of well-known tools, and the rules you left in. You read each rule before it goes. No project, no file name and nothing you said is in it.

Mason writes the file and posts nothing.

## Try someone else's

Press **Open one** and choose a file, or drop it on the view. Theirs is shown in the large figures with yours beside each, for the same kind of work.

A rule of theirs is not written by Mason. It is handed to an agent you choose:

1. Beside the rule stand the agents on this Mac that open with a prompt in their input: Claude Code, Codex, Cursor. **Copy prompt** is there for any other.
2. The agent opens with the prompt ready and not sent. Read it.
3. Press Enter. The agent shows the change before it saves.

The prompt asks for one line under `## Learned by Mason` in each rules file that exists (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.grok/AGENTS.md`), so one hand-over reaches every agent.

## What is let in

That file is a stranger's, and its rules go where an agent reads its instructions. So nothing in it is taken as it stands:

- Figures are read as figures, and names are cut short.
- Only tools Mason knows by name are named.
- A rule is offered only when it is one plain sentence about how to work: no command, no address, no path, nothing about secrets, nothing that tells an agent to set its rules aside or to stop asking, nothing about publishing, sending, deleting or paying, and no character that cannot be seen.

A rule that is held back is still shown, with the reason, and is not handed over.

This is a net, not a judge. Read the prompt before you send it.

## The collection

The folder [`workflows/`](../workflows/README.md) of the repository holds one file for each workflow and a page made from them.

**Add yours.** In the share dialog, press **Add to the collection**. That copies your file in the form the collection keeps and opens a form in the browser to paste it into. It is sent from there, by you, or not at all. A pull request that adds the file to the folder works too.

A file is let in only in the form a careful reading gives it. `npm run workflows -- check` runs that reading, on your Mac and on every pull request.
