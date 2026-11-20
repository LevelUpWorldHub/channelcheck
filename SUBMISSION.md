# Devpost — paste-ready

## Title

ChannelCheck

## Tagline

Static analyzer, IPC deadlock detector, and interactive security-policy workbench for QNX 8.0 systems.

## Inspiration

A QNX 8 image is three texts that drift apart. The buildfile starts a daemon as root. The policy still says `allow *`. Two resource managers `MsgSend` into each other and the receive threads never return. Each file looks plausible alone. The bug is the relationship. We wanted one host tool that reads the buildfile, the security policy, and the Neutrino calls, and shows the cycle on one graph.

## What it does

ChannelCheck is a host-based developer tool for software that targets QNX SDP 8.0. It parses real `mkifs` buildfiles and real secpol, and it parses C/C++ that calls `ChannelCreate`, `MsgSend`, `MsgReceive`, `resmgr_attach`, and `secpol_transition_type`. It builds the cross-process IPC graph, finds synchronous `MsgSend` deadlocks, flags channels that can inherit a client's priority, and flags a policy that grants root or a wildcard. The CLI gates CI with a non-zero exit. The workbench draws the graph, the boot timeline, and a before/after score, and it can apply the mechanical fixes and export SARIF 2.1.0.

It also prints a least-privilege policy from the paths and the edges it observed. That synthesis is a deterministic pass over the graph. It is not a language model, and it never grants `PROCMGR_AID_ROOT`, `mem_phys`, or `able_priv`.

## How we built it

TypeScript and Node 22. The engine has no filesystem and no DOM, so the CLI and the Vite/React workbench run the same functions. Samples are four QNX 8.0 workspaces: an ADAS sensor bus, an infusion-pump resource manager, a factory PLC, and a hardened baseline. Each has C, a `.build`, a `.secpol`, a Makefile (`qcc -Vgcc_ntox86_64` / `qcc -Vgcc_ntoaarch64le`, `mkifs`, `secpolcompile`), and the shared CMake toolchain files for x86_64 and aarch64le. The grammars follow the QNX 8.0 `mkifs` and security-policy language pages.

## Challenges

`MsgSend` in `main` before the receive loop is a normal startup RPC, not a deadlock. A pulse does not wait for a reply, so it must not close a cycle. `mkifs` attributes are sticky, and a bare filename lands in `/proc/boot`, which is how duplicate targets show up. In secpol, a colon inside an ability range is not the colon that separates a class. The fixer has to edit the buildfile and the policy together: once a wildcard `allow` is narrowed, the real `MsgSend` needs an explicit `channel connect` or the rescan grows a new finding. Getting that to a fixed point, and keeping the hardened sample at zero findings, took more care than the parser.

## Accomplishments that we're proud of

The ADAS sample goes from a visible `MsgSend` cycle and a root ability to zero critical findings in one fix, and a second fix does not change the files again. The hardened baseline scans clean. The same engine runs in the terminal and in the browser, including on files the user drops in. We did not pretend the SDP executed.

## What we learned

On QNX the security boundary is the type in the policy, the `on -T` in the script, and the channel the C actually uses. Checking one of those files is how the other two rot. Priority inversion here is not a mutex: without `_NTO_CHF_FIXED_PRIORITY` the receive thread adopts the sender's priority.

## What's next

A watch mode for a tree that is mid-edit, and a check that a `secpol_transition_type` string matches the `on -T` type of that binary. Both stay on the same engine.

## Built with

TypeScript, Node.js, React, Vite, Tailwind CSS, QNX SDP 8.0, QNX Neutrino, mkifs, secpol, SARIF

## Category

Best of Developer Tooling & Host Tools

Also aimed at the Grand Prize.

## Bonus prizes

- Best Use of QNX-specific Technologies — the analyzer is the `mkifs` grammar, the QNX 8.0 secpol language, and Neutrino message passing. The samples are IFS images for x86_64 and aarch64le.
- Best Codelab / Tutorial — `docs/CODELAB.md`, the Codelab tab in the workbench, and `docs/codelab/index.html`. Six steps: write a resource manager, the buildfile, and the policy; detect the `MsgSend` deadlock and the privilege leak; remove them with ChannelCheck; build and boot with QNX SDP 8.0 QEMU for x86_64 and aarch64le.

## Codelab URL

In the repo: `docs/CODELAB.md` and `docs/codelab/index.html`. In the running workbench: the Codelab tab (same origin as the site, path `/` with the tab selected).

## Try it

```bash
npm install
npm run dev
```

Open the ADAS sensor bus. Click Apply safe fixes. Critical findings go to 0.
