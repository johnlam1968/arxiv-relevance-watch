See [AGENTS.md](AGENTS.md) — it is the agent-facing entry point for this repository and is
harness-agnostic. It covers what the tool does, what it cannot do, how to decide whether it fits,
and how to help someone who cannot run it.

Two things worth repeating here because they are the ones an assistant most often gets wrong:

- **No chat or completion model is called anywhere in this tool.** Judgement comes from a System One /
  Jev-style decision model answering typed questions. Do not describe it as an AI paper summariser.
- **If you cannot execute it, do not produce a plausible-looking ranked list of papers.** Say you
  cannot run it, then do the part you can: interview the human, and author the two config files
  documented in [docs/config-reference.md](docs/config-reference.md).
