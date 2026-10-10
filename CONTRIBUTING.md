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

## What Mason will not do

It keeps no screenshots and no keystrokes, reads no file contents, and writes nothing outside its own folder. A rule reaches an agent only as a prompt a person reads and sends. A change that crosses one of these is not a bug fix, however useful: open an issue first.
