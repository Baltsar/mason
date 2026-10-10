# Models and voice

Mason is not tied to one model. Watching, counting, the look back, Flow and Days are plain code and need none. A model writes the summaries, a voice speaks them, and a small model on your Mac finds what you said. Each is optional, and each can be swapped.

| | Used for | Default | Without it |
|---|---|---|---|
| [The model](#the-model) | Summaries, proposals, the recap script | Your own Claude login | The memory is your own words |
| [Voice](#voice) | Speech, dictation, calls, the recap | Off until there is a key | The Mac's own voice, typed answers |
| [Find by meaning](#find-by-meaning) | Find, and the nudge "Done before" | Off | No Find |

## The model

A model is asked five things: the summary of a project, the script of the weekly recap, which of your repeated rules mean the same, which of the things you said again and again is a way of working and not a job, and what each project was for. Everything else is plain code.

By default the model is Claude through your own login, the Claude Code CLI already on the Mac: the same place your prompts already went. It is sent redacted excerpts of them.

To use another, name it in `apprentice/.env.local`:

```dotenv
APPRENTICE_LLM_URL=http://127.0.0.1:11434/v1
APPRENTICE_LLM_MODEL=llama3.2
APPRENTICE_LLM_KEY=
```

That example is Ollama on this Mac. Anything that answers in the OpenAI chat format works: a model on the Mac, or any provider's address. The key is only for a provider that asks for one.

**Summaries** in Settings shows which model is writing and switches it off. On the same row stand the tokens it took today, and under it the last seven days. The count is the provider's own figure; nothing of what was sent or answered is kept with it.

A summary sends some six thousand tokens of your prompts, so it is written an hour after you leave a project and not while you work in it.

When the model refuses (a login that ran out, a key that is not taken, no usage left) the row says so, and how to mend it.

## Voice

Put an ElevenLabs key in `apprentice/.env.local`. The file is local and ignored by git.

```dotenv
ELEVENLABS_API_KEY=...
```

| What | ElevenLabs product | Cost control |
|---|---|---|
| Spoken questions, where you left off, today's recap | Text to Speech, Flash v2.5 | Every sentence is cached on disk and replayed for free. |
| Spoken answers and dictation | Scribe v2 Realtime | Push-to-talk only. The socket lives from the press to the end of the sentence, 45 seconds at most. |
| The debrief call, the recall call, the tutor call | Agents | Three agents, created once in your account and reused. A call is capped at four minutes. |
| The weekly recap | Text to Dialogue, v3, two voices | One take of about two minutes, recorded once and replayed from disk. |

The key never reaches a page: the server hands out a single-use token and a signed call link.

**Voice** in Settings switches ElevenLabs off, next to what is left of the month's credits. Switched off, Mason speaks with the Mac's own voice, answers are typed, there are no calls, and nothing is sent or spent.

Another voice, another language and another model for the agents are set in `.env.local`: see [Settings and configuration](configuration.md#in-envlocal).

Use headphones on a call. Through laptop speakers the agent can hear itself, and then falls back to taking turns.

## Find by meaning

Off until you switch it on, in Settings (**What you said, by meaning**) or on **More → Find**. An embedding model on this Mac reads what you said to your agents and places each prompt by its meaning. The model writes nothing and nothing is sent anywhere: it runs while it is needed, listens on this Mac only, and is stopped after three minutes of quiet.

Two things are needed, and neither is in the repository:

1. **A model,** a `.gguf` file, in `apprentice/data/models/`. Mason was built with [EmbeddingGemma 2](https://huggingface.co/ggml-org/embeddinggemma-2-GGUF) (`embeddinggemma-2-Q8_0.gguf`, 310 MB, Apache 2.0). Mason never downloads it by itself.
2. **llama.cpp.** `brew install llama.cpp`, or a build from [its releases](https://github.com/ggml-org/llama.cpp/releases) unpacked into `apprentice/.runtime/llama/`, which is looked in first.

Any other embedding model works the same way, and the index starts again when the model changes:

```dotenv
APPRENTICE_EMBED_URL=http://127.0.0.1:11434/v1
APPRENTICE_EMBED_MODEL=nomic-embed-text
```

Each prompt is kept redacted, up to 600 characters, in `data/said/`. What was said after the first 600 characters of a prompt cannot be found. **Forget** in Settings empties it.
