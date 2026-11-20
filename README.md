# ChannelCheck

Static analyzer, IPC deadlock detector, and interactive security-policy workbench for QNX SDP 8.0.

ChannelCheck reads the three artifacts that actually define a QNX 8.0 image: the `mkifs` buildfile, the security policy, and the Neutrino C that calls `MsgSend` and `resmgr_attach`. One engine serves the CLI and the browser. It runs on Linux, macOS, and Windows with Node 22. It does not need the QNX toolchain to analyze a tree.

## What it checks

**IFS buildfiles (`.build`).** Real `mkifs` syntax: `[virtual=x86_64,bios]`, `[+script]`, `[uid= gid= perms=]`, `[type=link]`, `procnto-smp-instr`, `startup-*`, `secpolpush`, `io-sock`, `devc-*`, `slogger2`. It flags a missing or late `secpolpush`, root-owned daemons without `on -T`, setuid and world-writable modes, an unsafe `PATH=`, `ksh` or `qconn` left in the image, duplicate targets, and a foreground command that blocks the rest of the script.

**Security policy (`.secpol`).** Real QNX 8.0 statements: `allow`, `allow_attach`, `allow_channel`, `allow_link`, `ability`, `procmgr_ability`, `PROCMGR_AID_*`, `derive_type`, and `on -T` in the buildfile. It flags wildcard allows, `PROCMGR_AID_ROOT`, `PROCMGR_AID_MEM_PHYS`, `PROCMGR_AID_ABLE_PRIV`, types the image never launches, types the policy never declares, and a `MsgSend` with no `allow … :channel connect`.

**Message passing.** `ChannelCreate`, `ChannelCreate_r`, `ConnectAttach`, `MsgSend`, `MsgSendv`, `MsgReceive`, `MsgReceivePulse`, `MsgReply`, `resmgr_attach`, `dispatch_create_channel`, `secpol_transition_type`, `SIGEV_PULSE_INIT`. It builds the cross-process graph, finds synchronous `MsgSend` cycles between receive threads, flags channels that can inherit a client's priority, and flags unchecked sends and unguarded `io_devctl` / `io_open` handlers.

`channelcheck policy` prints a policy synthesized from the paths and the edges it saw. The synthesis is deterministic. It is not a language model, and it does not grant root.

## Host setup

Node.js 22 or newer.

```bash
npm install
npm test
npm run typecheck
npm run dev
```

The workbench listens on [http://127.0.0.1:4179](http://127.0.0.1:4179). It opens on the ADAS sensor bus, which is broken on purpose.

```bash
npx channelcheck scan examples/adas-sensor-bus
npx channelcheck graph examples/adas-sensor-bus
npx channelcheck fix examples/adas-sensor-bus --dry-run
npx channelcheck fix examples/adas-sensor-bus --write
npx channelcheck sarif examples/adas-sensor-bus -o adas.sarif
npx channelcheck ci examples/adas-sensor-bus          # exits 1
npx channelcheck ci examples/hardened-baseline        # exits 0
npx channelcheck policy examples/hardened-baseline
npm run build && npx channelcheck ui --port 4179
```

`scan` always exits 0. `ci` exits 1 when any finding is critical or error. `fix` is a dry run unless you pass `--write`.

Drop your own `.build`, `.secpol`, and `.c` files onto the workbench. Edit them in the Source tab. The score updates as you type. **Apply safe fixes** patches the buildfile, the policy, and the C in the browser and shows the diff.

## Samples

| Workspace | CPU in the buildfile | What it is for |
| --- | --- | --- |
| `examples/adas-sensor-bus` | x86_64 BIOS | The demo. MsgSend cycle, root abilities, ksh, late secpolpush. |
| `examples/infusion-pump` | aarch64le raw | High-priority unconfined pump, physical-memory ability. |
| `examples/factory-plc` | x86_64 BIOS | Wildcard channel allow, qconn, duplicate target. |
| `examples/hardened-baseline` | x86_64 BIOS | Clean image. `channelcheck ci` exits 0. |

## QNX SDP 8.0 and QEMU

Install [QNX SDP 8.0](https://www.qnx.com/developers/docs/8.0/com.qnx.doc.neutrino.utilities/topic/about.html) and source its environment. The path varies by install. A typical layout is:

```bash
. /opt/qnx800/qnxsdp-env.sh
```

That puts `qcc`, `mkifs`, and `secpolcompile` on `PATH` and sets `QNX_HOST` and `QNX_TARGET`.

Build every sample for the CPU its buildfile names, or cross both ways. The Makefiles select the compiler variant:

- `CPU=x86_64` → `qcc -Vgcc_ntox86_64`
- `CPU=aarch64le` → `qcc -Vgcc_ntoaarch64le`

```bash
make -C examples/adas-sensor-bus CPU=x86_64
make -C examples/factory-plc CPU=x86_64
make -C examples/hardened-baseline CPU=x86_64
make -C examples/infusion-pump CPU=aarch64le
```

Each Makefile compiles the C, runs `secpolcompile -o <name>.secpol.bin <name>.secpol`, then `mkifs <name>.build <name>.ifs`.

CMake toolchains live in `cmake/`. They require `QNX_HOST` and `QNX_TARGET`.

```bash
cmake -S examples/hardened-baseline -B build/telemetry-x86 \
  -DCMAKE_TOOLCHAIN_FILE="$PWD/cmake/qnx800-x86_64.cmake"
cmake --build build/telemetry-x86

cmake -S examples/infusion-pump -B build/pump-arm \
  -DCMAKE_TOOLCHAIN_FILE="$PWD/cmake/qnx800-aarch64le.cmake"
cmake --build build/pump-arm
```

Boot the image you just built:

```bash
sh scripts/qemu-x86_64.sh examples/hardened-baseline/telemetry.ifs
sh scripts/qemu-aarch64le.sh examples/infusion-pump/pump.ifs
```

`virtual=x86_64,bios` is a disk image, so the x86 script uses `-drive file=…,format=raw,media=disk`. `virtual=aarch64le,raw` is loaded with `qemu-system-aarch64 -M virt -kernel`. The scripts exit if `qcc` is not on `PATH`. They will not silently skip the boot and print a fake console.

### What was run on this project

Verified on Linux with Node 22: `npm test`, `npm run typecheck`, `npm run build`, and the CLI against the four samples. `qcc` is not installed in that environment. No `mkifs`, `secpolcompile`, or QEMU transcript in this repository was produced by executing the SDP. The buildfiles, policies, and C are written to the QNX 8.0 grammars published at:

- [mkifs](https://www.qnx.com/developers/docs/8.0/com.qnx.doc.neutrino.utilities/topic/m/mkifs.html)
- [Security policy language](https://www.qnx.com/developers/docs/8.0/com.qnx.doc.security.system/topic/manual/secpol_language.html)

## Codelab

[docs/CODELAB.md](docs/CODELAB.md) is a six-step lesson: write the resource manager, the buildfile, and the policy; break the ADAS image; repair it with ChannelCheck; build and boot on SDP 8.0. The same steps are in the workbench Codelab tab and in [docs/codelab/index.html](docs/codelab/index.html).

## Layout

```
src/engine     parsers, graph, fixer, SARIF  (no filesystem, no DOM)
src/cli        channelcheck
web/           Vite workbench
examples/      four QNX 8.0 workspaces
cmake/         qnx800-x86_64.cmake, qnx800-aarch64le.cmake
scripts/       QEMU launchers
```

The workbench imports `src/engine` directly. `npm run build` typechecks the CLI into `dist/` and writes the static site to `dist-web/`. `vercel.json` publishes `dist-web`.

## License

Apache-2.0. See [LICENSE](LICENSE).
