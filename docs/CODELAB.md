# Codelab: a QNX 8.0 resource manager, its policy, and the deadlock ChannelCheck finds

Time: about 45 minutes on a host with Node 22. The last step needs [QNX SDP 8.0](https://www.qnx.com/developers/docs/8.0/com.qnx.doc.neutrino.utilities/topic/about.html) (`qcc`, `mkifs`, `secpolcompile`) and QEMU. ChannelCheck itself is a host tool. You can finish steps 1–5 on Linux, macOS, or Windows with no QNX install.

The interactive copy of this lesson is the **Codelab** tab in the workbench, and a standalone page lives at [`docs/codelab/index.html`](codelab/index.html).

You will:

1. Write a QNX 8.0 resource manager that uses a fixed-priority channel.
2. Boot it from an IFS buildfile that pushes a security policy first.
3. Grant only the channel connect that the client actually uses.
4. Look at a real `MsgSend` deadlock and a root ability in the ADAS sample.
5. Remove both with ChannelCheck and rescan to zero critical findings.
6. Build the image with `qcc -Vgcc_ntox86_64` or `qcc -Vgcc_ntoaarch64le` and boot QEMU.

## Step 1 — Write the resource manager

A Neutrino resource manager is a process that owns a pathname. Clients `open()` that path and the kernel delivers the message to your receive loop. On QNX 8.0 the usual shape is:

- `ChannelCreate(_NTO_CHF_FIXED_PRIORITY)` so the receive thread does not adopt the sender's priority.
- `dispatch_create_channel(chid, 0)` so the dispatch library uses that channel. `dispatch_create()` hides the flags.
- `resmgr_attach` on a path such as `/dev/telemetry`.
- `secpol_transition_type(NULL, "telemetry_t", 0)` once the policy is pushed.
- `dispatch_block` / `dispatch_handler` forever.

`_NTO_CHF_FIXED_PRIORITY` matters on a safety or high-priority server. Without it, the receive thread runs at the client's priority. A low-priority client can hold the server there, and a higher-priority client waits. That is priority inversion through the channel, not through a mutex.

Check the returns. `ChannelCreate` returns `-1` and sets `errno`. `ChannelCreate_r` returns a negative errno and does not set `errno`. `resmgr_attach` returns `-1` on failure.

In `io_devctl`, call `iofunc_devctl_default` for the message shape, then decide who is allowed to change the device. The default helper does not know your security policy. Read `ctp->info.cred` or call `secpol_check` / `iofunc_check_access` and return `EPERM` when the credential is wrong.

The clean version of this pattern is `examples/hardened-baseline/telemetry_rm.c`.

```c
chid = ChannelCreate(_NTO_CHF_FIXED_PRIORITY);
if (chid == -1) {
    return EXIT_FAILURE;
}
dpp = dispatch_create_channel(chid, 0);
id = resmgr_attach(dpp, &resmgr_attr, "/dev/telemetry", _FTYPE_ANY, 0,
                   &connect_funcs, &io_funcs, &attr);
if (id == -1) {
    return EXIT_FAILURE;
}
secpol_transition_type(NULL, "telemetry_t", 0);
```

A client is shorter. `open` the path, check the descriptor, `MsgSend`, check the return. `MsgSend` blocks until `MsgReply`. That blocking is the whole reason step 4 can deadlock.

```c
fd = open("/dev/telemetry", O_RDONLY);
if (fd == -1) {
    return EXIT_FAILURE;
}
if (MsgSend(fd, &msg, sizeof msg, &msg, sizeof msg) == -1) {
    return EXIT_FAILURE;
}
```

## Step 2 — Put it in an IFS buildfile

`mkifs` reads a `.build` file and writes a bootable image. The grammar that matters here, from the QNX 8.0 `mkifs` utility:

- `[virtual=x86_64,bios +compress]` (or `aarch64le,raw`) names the boot format. The first executable in that block is `startup-*`. The last is `procnto`. On QNX 8.0 the SMP instrumented kernel is `procnto-smp-instr`.
- `PATH=` and `LD_LIBRARY_PATH=` in the bootstrap become `_CS_PATH` and `_CS_LIBPATH`. A `.` component or an empty component lets a later process load from the current directory.
- `[+script]` is an inline script. It runs as a thread after `procnto` initializes. It is not a shell. There are no pipes. A command without `&` runs in the foreground and the rest of the script waits.
- `secpolpush` loads `/proc/boot/secpol.bin` (or the path you pass). Processes started before that call are not confined by the policy you are about to push.
- `on -T type` starts a process in a security type. `on -T telemetry_t telemetry_rm &` is the line you want.
- `ksh` and `qconn` are development tools. A production image does not need a shell or a remote debug agent.
- Attributes stick. `[uid=0 gid=0 perms=4755]` on a line applies to that file. `4755` is setuid. Inline files default to `0666` on non-Windows hosts, which is world-writable. `[type=link]` creates a symlink. Two entries with the same target path are an `mkifs` error unless you set `+dupignore`.

The hardened script pushes policy before any daemon and backgrounds every long-running process:

```
[+script] startup-script = {
    display_msg "ChannelCheck hardened baseline"
    procmgr_symlink ../../proc/boot/libc.so.5 /usr/lib/ldqnx-64.so.2
    secpolpush
    on -T slogger_t slogger2 &
    on -T devc_t devc-ser8250 -e -b115200 0x3f8,4 &
    waitfor /dev/ser1
    reopen /dev/ser1
    on -T telemetry_t telemetry_rm &
    on -T telemetry_client_t telemetry_client &
}
```

`reopen` waits for its device. Call it after the driver that creates the device, not before.

## Step 3 — Write the security policy

The QNX 8.0 security-policy language is compiled with `secpolcompile` and pushed with `secpolpush`. Statements end with `;`. `#` starts a comment.

```
type telemetry_t;
type telemetry_client_t;

allow_attach telemetry_t /dev/telemetry;
allow telemetry_client_t telemetry_t:channel connect;

allow telemetry_t self:ability {
    spawn
    prot_exec
};
```

- `type` declares a domain.
- `allow_attach` is the path that type may register.
- `allow client server:channel connect` is what a `MsgSend` or `ConnectAttach` needs. `allow_channel client server` is the same idea.
- Abilities use the short names (`spawn`, `mem_phys`, `able_priv`) or the `PROCMGR_AID_*` forms. A range stays inside the braces: `mem_phys:0x1200000-0x24000000`.
- `allow type * : * *` matches everything. That is not least privilege.
- `PROCMGR_AID_ROOT`, `mem_phys`, and `able_priv` let a process rewrite the rules, map physical memory, or grant abilities. An ordinary device manager does not get them.
- Every `on -T` type must be declared. A declared type that nothing uses is leftover surface area.

## Step 4 — See the defect in the ADAS sample

`examples/adas-sensor-bus` is a small front-radar path: `sensor_rm` publishes `/dev/adas/sensor`, `fusion` publishes `/dev/adas/fusion`. Both are single-threaded resource managers. Each `io_devctl` opens the other path and calls `MsgSend`.

`MsgSend` does not return until the peer calls `MsgReply`. The only thread that can reply is the thread now blocked in `MsgSend`. The two servers wait on each other. A startup `MsgSend` in `main`, before the receive loop, is not this bug. A `MsgSendPulse` is not this bug either: a pulse does not wait for a reply.

The same image has the policy and boot problems the workbench is built to show:

- `allow sensor_t * : * *;`
- `PROCMGR_AID_ROOT`, `PROCMGR_AID_MEM_PHYS`, `PROCMGR_AID_ABLE_PRIV` on `fusion_t`
- `secpolpush` after the daemons, `ksh`, and `qconn`
- `PATH=...:.`
- `perms=4755` on `sensor_rm`, `perms=0666` on `fusion`
- a duplicated `/proc/boot/sensor_rm`
- `fusion` launched without `&`, so the script never reaches `secpolpush` if fusion blocks

Read `sensor_rm.c`, `fusion.c`, `adas.build`, and `adas.secpol` before you run the tool. The defects are in the source, not in a hidden fixture.

## Step 5 — Run ChannelCheck

From the repository root, with Node 22:

```bash
npm install
npx channelcheck scan examples/adas-sensor-bus
npx channelcheck graph examples/adas-sensor-bus
npx channelcheck fix examples/adas-sensor-bus --dry-run
npx channelcheck ci examples/adas-sensor-bus
```

`scan` prints rule ids and file:line. `graph` prints the process nodes, the secpol types, and which `MsgSend` edges sit on a cycle. `fix --dry-run` prints a unified diff and does not write. `ci` exits 1 when any finding is critical or error, which is what you want on a pull request.

Or start the workbench:

```bash
npm run dev
```

Open the ADAS sensor bus. The graph draws `sensor_rm` and `fusion`, their types, and a red cycle on the synchronous edges. The finding card quotes the `MsgSend` line and the QNX reason. **Apply safe fixes** patches the in-memory sources and rescans.

What the repair does:

- The cycle edge becomes `MsgSendPulse`. The other direction stays a checked `MsgSend`. One reply-waiting edge is enough to break the wait.
- `ChannelCreate(0)` becomes `ChannelCreate(_NTO_CHF_FIXED_PRIORITY)`. A bare `dispatch_create()` becomes `dispatch_create_channel`.
- Unchecked `MsgSend` and `ConnectAttach` returns are tested. `io_devctl` gains a credential check.
- `secpolpush` moves up, ahead of the daemons. `ksh` and `qconn` are removed. `on -T` is added. Setuid and world-writable mode bits are cleared. The duplicate target is removed. `secpol.bin` is added to the image.
- The wildcard allow is replaced with a channel connect. Root, physical-memory, and ability-grant rules are removed. A missing `allow` for the remaining edge is added. An unused type is deleted.

Scan again. Critical and error counts are 0. `examples/hardened-baseline` starts at 0, and `npx channelcheck ci examples/hardened-baseline` exits 0.

Export SARIF 2.1.0, JSON, or Markdown from the workbench, or:

```bash
npx channelcheck sarif examples/adas-sensor-bus -o adas.sarif
```

`channelcheck policy examples/adas-sensor-bus` prints a policy synthesized from the paths and the `MsgSend` edges. It is deterministic. It grants `allow_attach`, `channel connect`, and `spawn`. It does not grant root.

## Step 6 — Build and boot with QNX SDP 8.0

On a machine where SDP 8.0 is installed:

```bash
. /opt/qnx800/qnxsdp-env.sh

make -C examples/hardened-baseline CPU=x86_64
make -C examples/adas-sensor-bus CPU=x86_64
make -C examples/factory-plc CPU=x86_64
make -C examples/infusion-pump CPU=aarch64le
```

Each Makefile calls:

- `qcc -Vgcc_ntox86_64` or `qcc -Vgcc_ntoaarch64le`
- `secpolcompile -o policy.bin policy.secpol`
- `mkifs image.build image.ifs`

CMake, when you prefer it:

```bash
cmake -S examples/hardened-baseline -B build/telemetry-x86 \
  -DCMAKE_TOOLCHAIN_FILE=$PWD/cmake/qnx800-x86_64.cmake
cmake --build build/telemetry-x86

cmake -S examples/infusion-pump -B build/pump-arm \
  -DCMAKE_TOOLCHAIN_FILE=$PWD/cmake/qnx800-aarch64le.cmake
cmake --build build/pump-arm
```

The x86_64 buildfile uses `[virtual=x86_64,bios]`, which is a disk image. The aarch64le buildfile uses `[virtual=aarch64le,raw]`, which QEMU can load with `-kernel`.

```bash
sh scripts/qemu-x86_64.sh examples/hardened-baseline/telemetry.ifs
sh scripts/qemu-aarch64le.sh examples/infusion-pump/pump.ifs
```

The scripts refuse to run when `qcc` is absent, so a host that only has Node cannot pretend it booted the image.

**What was verified where.** The parser, the deadlock detector, the fixer, the SARIF output, the CLI exit codes, and the workbench were run on Linux with Node 22. `qcc`, `mkifs`, `secpolcompile`, and QEMU were not installed in that environment, and this codelab does not include their console output. The commands above are the SDP 8.0 commands to run on a machine that has the toolchain.

## What to try next

- Add a third process that `MsgSend`s into `telemetry_rm` and watch the missing `allow` appear.
- Put `ksh` back into the hardened script and confirm `QNX-IFS-DEBUG-SHELL`.
- Change `ChannelCreate(_NTO_CHF_FIXED_PRIORITY)` to `ChannelCreate(0)` and confirm the priority finding on a file marked `criticality: high`.
