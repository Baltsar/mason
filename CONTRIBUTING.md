# Contributing

Mason is one person's tool that others are welcome to use, copy and improve. Two kinds of contribution are expected: a workflow for the collection, and a change to the code.

## Add your workflow

In Mason, open **Workflow**, press **Share**, choose the rules that go with it and press **Add to the collection**. That copies the file and opens [a form](https://github.com/Baltsar/mason/issues/new?template=workflow.yml) to paste it into. Or open a pull request that adds the file to [`workflows/`](workflows/):

```bash
cd apprentice
npm run workflows -- add ~/Downloads/your-workflow.json   # puts it in, in the form the collection keeps
npm run workflows -- build                                # writes the page and the index
npm run workflows -- check
```

A pull request that adds a workflow changes nothing outside `workflows/`. What is let in, and why, is said on [the collection's page](workflows/README.md#what-is-let-in): figures, the names of known tools, and rules that are plain habits of work. No project, no file name, nothing that was said.

## Change the code

```bash
cd apprentice
npm test
```

- The app is in `apprentice/`: a Node server with no dependencies (`src/`), the window (`public/`), and the Swift island and reader (`native/`). Please add no dependency without asking first.
- Plain JavaScript modules, Node 18. A comment says why, in plain words; the code says what.
- A change comes with a test beside the others in `apprentice/test/`. A test that writes sets `APPRENTICE_DATA` to a folder of its own before it loads anything from `src/`, or it writes into your real memory.
- To try a change without touching your own memory, start a rehearsal: see [Verify](apprentice/README.md#verify).
- Commits are small and say one thing, in the form `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- Anything new that reads something, or sends something off the Mac, gets a switch and a line in Settings.

## Change the docs

The docs are the Markdown files in [`docs/`](docs/), one for each page, and the site is built from them. There is no second copy to keep up. To fix a page, edit its file; **Edit this page** under each page on the site opens it.

`npm test` compares the docs with the code. It fails when a switch in Settings, a variable, an MCP tool, a command or a view of the app window is not in the docs, when the docs still name one that is gone, and when a link between pages is dead. So a change that adds a switch adds its line in [Settings and configuration](docs/configuration.md) in the same pull request, and the test says so if it was forgotten.

A new page is a Markdown file in `docs/` that opens with a `# ` heading, and one line in [`docs/docs.json`](docs/docs.json).

## What Mason will not do

It keeps no screenshots and no keystrokes, reads no file contents, and writes nothing outside its own folder. A rule reaches an agent only as a prompt a person reads and sends. A change that crosses one of these is not a bug fix, however useful: open an issue first.

## Conduct

Be decent to the people here. See the [Code of conduct](CODE_OF_CONDUCT.md).
