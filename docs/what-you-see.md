# What you see

Mason has three surfaces: the island in the menu bar, the panel under it, and the app window. Each is made to be read in one to three seconds: a figure or a few words in large type, the detail one press away.

| Where | What it is for |
|---|---|
| [The island](#the-island) | Which project you are in, and the share of today that was work. |
| [The panel](#the-panel) | Where you left the project, and today in three figures. |
| [Today](#today) | The day by project, the look back and the proposals. |
| [Flow](#flow) | How you moved between tools. Replay and Share are here. |
| [Days](#days) | Every day worked, and the tokens your agents took. |
| [Workflow](#workflow) | Thirty days of how you work with agents, as one card. |
| [Projects](#projects) | Every project in one place: where you left it, a way to pick it up, and a quiz about it. |

## The island

A strip of dark glass inside the menu bar, growing leftwards from the notch: a hand at work, and the work share in per cent. It takes only the free room between the menus of the app in front and the notch, so it covers no menu, no status icon and no window. With little room it keeps only the mark, and behind an app with very many menus it is not there at all.

When something changes, one word shows for a few seconds: the name of the project, `Private`, `Debrief ready`.

To the right of the notch sits **the eye**:

| The eye | Means |
|---|---|
| A ring with a pupil | It is watching. |
| One ripple | It took in something new: another window, a prompt. |
| A turning arc | It is working something out: a summary, an episode. |
| A closed line | It looks away. You pressed **Go private**. |
| A broken orange ring | It has no access. See [When something is off](troubleshooting.md#the-island-says-access). |

## The panel

Press the island. The project you were last in, where you left it in six words, and today's split in large type: work, social, other. They always sum to 100. Time inside a project counts as work whatever the window is called, and idle time over a minute is left out. The day turns over at 04:00, so a late night stays one day.

Two round buttons: hear where you left off, and an arrow that opens the project in the window, ready to be picked up in a new session. A third, lime, is there only when a debrief call is ready.

Press a figure to open the app window.

## Today

The split of the day, then one line per project: its name, where it was left, the time, a play button. Press a line for the rest: what the project is, how it is put together, what was built, what is still open.

Two things turn up here by themselves.

**The look back.** After three days of work Mason says how the work was done, in at most three plain sentences: where you went right after sending a prompt, how long finished answers waited, how often you changed tool. It is written once and left as it was, with the numbers one press away. Mason is never told what a day is for.

**A proposal.** What you told your agents again and again, in several projects, is proposed as one rule, shown with the words it rests on. Mason does not write it. **Give it to Claude Code** (or Codex, or Cursor) opens that agent with a prompt that is ready and not sent. You read it, press Enter, and the agent shows the change before it saves. The wording can be changed first. A rule that would let agents publish or delete without asking is never proposed. See [Rules for every agent](agents-and-mcp.md#rules-for-every-agent).

## Flow

The tools of the day with their own icons, and a line between two of them as thick as the jumps between them. Two figures on top: the jumps, and the longest unbroken stretch. A tool in a browser tab is known by the site it is on. Under the picture every tool of the day is named, and pressing one shows it among the tools it trades places with.

**Replay** cuts one piece of real work for someone else to sit beside: every prompt as it was said, how long the agent worked on it, where you were meanwhile, and how long the answer waited. Nothing is recorded for it: it is cut afterwards from what Mason keeps anyway. You read every line and press the ones to leave out. Until you switch names on, a project is "Project A". **Save page** writes one HTML file to `data/share/`, **Copy as text** puts it on the clipboard.

**Share** draws the flow of the day or the week as one picture, 1080 by 1350. Only the names of tools are on it. It starts with the five tools the work was done in, and any tool goes in or out with a press, seven at most.

Mason writes the file and posts nothing.

## Days

A calendar of every day worked, back to the first day of each project, and each project's month as a strip. Beside the hours with agents stand the tokens they took, by day and by project, as the agents' own logs count them. It is a count, not a cost.

**The week as news**, under the month, is the recap: the week as a two-minute bulletin in two voices. It needs a voice: see [Models and voice](models-and-voice.md#voice).

## Workflow

Thirty days of the agents' logs as one card: which agent you talk to and how much, prompts an hour, how long an agent works on one prompt, how many projects a day, the tokens a day of work takes, and what you tell your agents again and again. It is read from logs that are already on the Mac, so it is there the first day.

Share makes it a picture and a file. Opening someone else's file puts theirs beside yours. See [Share and try workflows](workflows.md).

## Projects

Every project you worked in during the last three weeks, the one last touched first. A line each: its name, where you left it in a few words, and how long ago. Two things can be done with a project, and both are on its line.

**Continue.** A project, handed to a new session. An agent starts every session knowing nothing; Mason holds what it needs, written from the agents' own logs. **Continue in Claude Code**, Codex or Cursor opens that agent with the short of it in its input: what the project is, where you stopped, what is open and the last thing you asked for, in a few lines you can read before you press Enter. Nothing is sent until you do, and Mason writes nothing into the project. Claude Code is started in the project's own folder, in a terminal, and first shows the command that starts it: a few lines of packed letters, which are the folder and those lines. All the notes (how it is put together, what was decided and why, everything you asked for since) are kept as a file in Mason's own folder, which the short of it names, and **Copy all notes** gives them for a teammate or a pull request. What was done with one agent can be picked up with another. A project's row in Today and the arrow in the panel lead here too.

**Quiz.** A quiz about your own projects, five questions at a time: which one it is, what each part does, where it runs, where you left it. Each question has up to four answers to choose between; press one, or the figure beside it. Right or wrong is said at once, with the reason in a line. A question you got wrong is asked once more at the end of the round and comes back tomorrow; one you got right comes back after three days, then a week, three weeks, two months.

The questions are written by the model that writes the summaries, in the same call, and the wrong answers are partly what is true of your other projects. Without a model there are no questions, and Built says so with the switch that mends it. **Ask me aloud** turns it into a call; without a voice it says what is missing.

**Find something you said**, under the list, finds a project by what it was about, by meaning and not by the words, in Swedish or English. With nothing typed it shows what you told your agents again and again across projects. Off until switched on: see [Find by meaning](models-and-voice.md#find-by-meaning).

## When you come back

Back at the Mac after half an hour or more (a meeting, lunch, the night), one line drops from the menu bar and is gone after seven seconds: the project you last worked in, where you left it, and the share of today that was work. A press on the project opens it under Projects, ready to be picked up in a new session. It is quiet on purpose: no sound, no colour of its own, and nothing if you went straight to that project. The bell on the line switches it off, as does **When you come back** in Settings.

## Nudges

A nudge is a word in the menu bar at the moment it can be acted on. It rests on your own history, never on a clock or a list you keep. There are two:

- **Waited 9 min · PROJECT.** An answer has waited twice as long as you usually leave one, while you are at the Mac in another tool.
- **Done before · PROJECT.** A prompt you just sent is the same piece of work as one in another project, a day or more ago. Needs Find switched on.

Each nudge is followed up. A kind you ignore three times in a row goes quiet for two weeks by itself. At most one in ten minutes and six in a day. **Nudges** in Settings shows how the last week went and switches them all off.

## Calls

With a voice switched on, Mason can call you. Nothing rings: a call is offered, and you take it when you have two minutes.

- **The debrief.** After a block of real work the island says `Debrief ready`. Mason opens with what it saw and asks three or four short questions. An answer that holds a decision or a rule is saved in your words while you talk. It explains the whole thing back and asks what it got wrong.
- **The recall call.** **Quiz me** in a project's row in Today, or **Ask me aloud** in the quiz. Mason asks you how your own project is put together, says what you had right and brings up what you left out.

You always see whether you are heard: the microphone's level moves around its icon, and one word says who has the floor.

## It is free

After forty days of work a card says, the way an old archiver did, that the trial has ended and a license must be bought, and then that there is no license. It asks once for work for the man who built it. **Use evaluation copy** puts it away for good. Nothing is locked, before or after.

## Go private

Press the pill at the top of the app window, the one that says what Mason is doing. Everything stops at once and the eye closes. Nothing is recorded until you press it again.
