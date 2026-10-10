<!-- Written by "npm run workflows -- build" from the files in this folder. Change a file, not this page. -->

# Workflows

How people work with coding agents, measured and not told. Each one was read by [Mason](../README.md) out of the agents' own logs on its owner's Mac: who they talk to, at what pace, how long an agent works on one thing, and what they tell their agents again and again. No project, no file name and nothing that was said is in any of them.

**Try one.** Save its file, open Workflow in Mason and drop the file there (or press *Open one*). Theirs is shown beside yours, and a rule of theirs can be handed to the agent you choose: Claude Code, Codex or Cursor opens with a prompt that is ready and not sent, you read it and press Enter, and the agent shows you the change before it saves. Mason writes none of it for you.

**Add yours.** In Mason, open Workflow, press *Share*, choose the rules that go with it and press *Add to the collection*. That copies the file and opens a form here to paste it in. Or open a pull request that adds the file to this folder. Either way it is checked the same way as a file someone opens: see [what is let in](#what-is-let-in).

## Building software

### An example \(made up\)

22 days with agents · 11 Sep to 10 Oct 2026 · 412 prompts

| Talks to | Prompts an hour | An agent works on one | Projects a day | Tokens a day |
|---|---|---|---|---|
| Codex 64%, Claude Code 36% | 4 | 13 min | 1 | 95M |

What they tell their agents, again and again:

- Write the plan as a numbered list and wait for a yes before changing any file. *(41 times, 3 projects)*
- Run the tests after every change and show the result. *(29 times, 3 projects)*
- Keep functions under forty lines; split them when they grow. *(9 times, 2 projects)*

[an-example-made-up-building-software.json](an-example-made-up-building-software.json)

## What is let in

A file in this folder is a stranger's, and its rules are made to be put where an agent reads its instructions. So a file is let in only as a careful reading gives it:

- figures are figures, and names are cut short;
- only tools Mason knows by name are named, so a customer's site cannot ride along;
- a rule is one plain sentence about how to work: no command, no address, no path, nothing about secrets, nothing that tells an agent to set its rules aside or to stop asking, nothing about publishing, sending, deleting or paying, and no character that cannot be seen;
- the file says nothing else, and says it in one fixed order.

`npm run workflows -- check` in `apprentice/` runs that check, and it runs on every pull request. Mason runs the same reading again on your Mac when you open a file, and it writes no rule itself: a rule goes to an agent as a prompt you read and send. Read it before you do: the check is a net, not a judge.
