# Security

Mason reads what you said to your coding agents and watches which app is in front. It is built so that this stays on your Mac and so that nobody else can steer it. This page says what it guards against, what it does not, and how to report a hole.

## Report a hole

Please do not open a public issue for something that can be used against people who run Mason. Use [GitHub's private report](https://github.com/Baltsar/mason/security/advisories/new) for this repository. Say what you did and what happened; a way to see it happen is worth more than a theory. You will get an answer within a week.

## What it guards against

- **A page in a browser.** The server listens on `127.0.0.1` only, answers only requests addressed to this Mac, refuses any page that is not Mason's own, and asks for a key that is made anew at each start and known only to Mason's own windows and the agents it was given to.
- **A stranger's workflow file.** Nothing in it is taken as it stands. Figures are read as figures, only known tools and agents are named, and a rule is offered only when it is one plain sentence about how to work. See [what is let in](workflows/README.md#what-is-let-in).
- **Words put where agents read their rules.** Mason writes no rule anywhere. A rule is handed to an agent as a prompt that is ready and not sent, with the rule fenced off as words to store; a person reads it and sends it, and the agent shows the change before it saves.
- **Secrets in what is kept or sent.** Mail addresses, keys, tokens, passwords, card numbers and personal identity numbers are masked before anything is written, sent to a model or shared.
- **Requests steered from outside.** When logos are switched on, a site is asked for its icon over https only, never at a private address, one redirect at a time; only pictures are kept.
- **The collection.** A pull request runs the tests and the collection check with read-only rights and no secrets, and one that adds a workflow may change nothing else.

## What it does not guard against

- **A program running as you.** It can read the same files Mason reads, and Mason's own folder.
- **The rule check is a net, not a judge.** It knows English and a little Swedish and holds back more than it must, but a harmful sentence in plain words can pass. Read a prompt before you send it to an agent.
- **What you choose to send.** Summaries go to the model you chose, and the voice to ElevenLabs, while their switches are on. A replay or a workflow you share is public once you share it.

The limits of each part are said where the part is described, in the app's [README](apprentice/README.md).
