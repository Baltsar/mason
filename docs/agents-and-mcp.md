# Agents and MCP

Mason reads the logs your coding agents keep, and gives what it learned back to them. An agent that starts in a month-old folder can know how the thing is put together before you have explained anything.

## Which agents it reads

| Agent | Where its logs are | What Mason takes |
|---|---|---|
| Claude Code | `~/.claude/projects` | Your prompts, the names of changed files, what the agent reported, tokens. |
| Codex | `~/.codex/sessions` | The same. |
| Grok | `~/.grok/sessions` | The same. |
| Cursor | Its workspace list | Which folder each workspace is, and when it was last used. Time, not memory. |

A session you typed in is yours: its prompts count as said, and its answers as waiting for you. A session another agent started with a brief of its own counts as time worked on the project and as tokens taken, and nothing more.

Chats in ChatGPT or on claude.ai are not on disk and are not read. **Agent logs** in Settings switches all of this off.

## Connect an agent

The memory is an MCP server. Add it to the agent's MCP configuration, with the path of your own clone:

```json
{
  "mcpServers": {
    "mason": {
      "command": "node",
      "args": ["/absolute/path/to/mason/apprentice/src/mcp.mjs"]
    }
  }
}
```

That command reads the files itself, asks no server and needs no key.

For an agent that cannot start a command, the same tools answer over HTTP at `http://127.0.0.1:4317/mcp` while Mason is running. That way needs the key of this start, sent as `Authorization: Bearer`. **More → Agents** in the app window copies the settings with the key in them. The key is new at every start, so they are pasted again after a restart.

**More → Agents** also lets you try each tool.

## The tools

| Tool | What an agent gets |
|---|---|
| `how_was_it_built` | How a project is put together, what was built, where it was left and what you keep telling your agents. Without a project, the one worked on last. |
| `guardrails_for_agents` | The Work Map as instructions an agent can load: the steps to follow, and where to stop and ask. |
| `check_decision` | A planned action checked against your rules before it is done. Answers STOP with your own words, or CLEAR. |
| `search_work_map` | Decisions, rules and discarded directions that match a query. |
| `what_happened_last` | The latest observed work session, with its sources. |
| `what_did_you_learn` | Learned decisions and rules in your own words, with sources. |
| `what_are_you_unsure_about` | The questions Mason still wants to ask you. |
| `how_was_the_day` | Today split into work, social and other, with the top apps. Private surfaces and idle time are never in it. |

## Rules for every agent

A correction you gave an agent in several projects is a rule you never wrote down. Mason finds these in the logs and proposes them, one at a time, on Today.

Mason writes no rule itself. It hands the rule to the agent you choose:

1. **Give it to Claude Code**, Codex or Cursor opens that agent with a prompt that is ready and not sent. **Copy prompt** serves any other agent. The words of the rule can be changed first.
2. You read the prompt and press Enter.
3. The agent shows the change before it saves: one line under `## Learned by Mason` in each rules file that exists (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.grok/AGENTS.md`).

Mason reads those files to see when the rule stands there. The proposal is then done, and the rule is listed under **In your agents' rules** in Settings with the agents that hold it. A rule that would let agents publish or delete without asking is never proposed.

A rule from someone else's workflow takes the same road. See [Share and try workflows](workflows.md#try-someone-elses).
