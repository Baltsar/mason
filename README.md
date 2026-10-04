# Apprentice

Learning by doing, without the forgetting.

I build by talking to agents. The code stays. The knowledge of how and why stays in the prompts, not in my head. A month later the answer is somewhere in one of 120 agent sessions.

Apprentice is a local macOS assistant that was there. It remembers how a project was built, asks me about it until it sticks, and hands my rules to every agent I use.

Built solo by Gustaf Garnow for Challenge 01, The AI Apprentice, at the Hack-Nation 7th Global AI Hackathon.

Live page with the three films: https://apprentice-demo.vercel.app

## Where things are

| Folder | What |
|---|---|
| [`apprentice/`](apprentice/) | The app: native macOS island, local server, ElevenLabs voice, MCP server. Start with its [README](apprentice/README.md). |
| [`film/`](film/) | How the three submission films were made: the app window is driven and recorded headlessly, then cut and captioned by script. |
| [`site/`](site/) | The public page. |

## Run it

```bash
cd apprentice
cp .env.local.example .env.local   # add an ElevenLabs key
open "Start Apprentice.command"
```

macOS 13 or later, Node 18 or later.

## What is not in this repository

The memory. `apprentice/data/` and `apprentice/wiki/` are built on your own Mac from your own agent logs, and they stay there.
