# ChannelCheck — build brief

## Finish-first scope

Shipped, and covered by tests:

- One TypeScript engine for `.build`, `.secpol`, and Neutrino C/C++.
- Deadlock cycles limited to synchronous `MsgSend` / `MsgSendv` on a receive thread.
- A fixer that rewrites those three artifacts together and is idempotent.
- CLI: `scan`, `graph`, `fix --dry-run` / `--write`, `sarif`, `ci`, `policy`, `ui`.
- Workbench: graph, findings with the source line, boot timeline, score before and after, live edit, drag-and-drop, SARIF / JSON / Markdown export, codelab tab.
- Four QNX 8.0 workspaces, both CMake toolchain files, both QEMU scripts, GitHub Actions.

The demo does not depend on a board, a login, or a model API.

## Cut list

- No binary IFS disassembler. The input is source.
- No Language Server. The workbench and the CLI are the interface.
- No flashing a physical board, and no claim that QEMU ran in CI.
- No second policy language. QNX 8.0 secpol only.
- No generated fixes for findings that need a human choice beyond the mechanical repairs (for example, which ability a custom driver truly needs). Those stay as findings.

## Demo moment

Load `examples/adas-sensor-bus`.

The graph shows `sensor_rm` and `fusion` with a red `MsgSend` cycle. The policy card shows the wildcard allow and `PROCMGR_AID_ROOT`. The timeline shows `secpolpush` after `ksh`.

Click **Apply safe fixes**.

The cycle is gone, the diff shows `MsgSendPulse` and the policy rewrite, and a rescan reports 0 critical findings.

That is the whole pitch: the three QNX artifacts, one cycle, one click, a clean score.

## Categories

- Best of Developer Tooling & Host Tools
- Grand Prize
- Bonus: Best Use of QNX-specific Technologies
- Bonus: Best Codelab / Tutorial — [docs/CODELAB.md](docs/CODELAB.md)
