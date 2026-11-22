# monet

Self-hosted photos for one owner, live at https://monet.kaleve.dev on kaleve-home. Start with `docs/spec.md`: it is
the contract every part builds against, and its rules (no new packages, who commits, no long dashes, German strings
from the design canvas) apply here as written. This file only adds how to work in the checkout.

## Work on main

Who commits is in the spec: the lead session, nobody else. When that is you: no branches, no worktrees (also not
`isolation: "worktree"` for subagents), commit small, `git pull --rebase` before each commit, push after it.
Uncommitted changes in the checkout belong to a session that is still working: never stash, reset or commit them
yourself.

Deploy only `main`, right after `git pull`, with nothing of yours uncommitted: `app/deploy/deploy.sh` builds the
checkout as it is, and a deploy from anything older overwrites newer work on the server.

## Checks

`tools/validate.sh` runs every part's checks; CI calls it per part.

| Part | Check | Needs |
|---|---|---|
| `app/` | `bun test` | Bun; libvips for the end-to-end test, which skips without it |
| `mac/` | `make test` | macOS, swiftc |
| `android/` | `android/tools/validate.sh` | JDK 21, the Android SDK |

Test photos are not in the repo. The end-to-end tests and `app/tools/dev-mock.ts` read the folder `MONET_TESTDATA`
names and skip or stop with a message when it is unset.
