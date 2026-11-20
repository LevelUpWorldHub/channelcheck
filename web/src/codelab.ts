export interface CodelabStep {
  n: string;
  title: string;
  body: string;
  code?: string;
  lang?: string;
}

export const codelabSteps: CodelabStep[] = [
  {
    n: "01",
    title: "Write a QNX 8.0 resource manager",
    body: "A Neutrino resource manager owns a pathname. Create a channel with _NTO_CHF_FIXED_PRIORITY so a low-priority client cannot pull a safety server down to its priority. Attach the path with resmgr_attach, transition into a secpol type, then block in dispatch_block. Check every ChannelCreate and resmgr_attach return. In io_devctl, look at ctp->info.cred before you change device state. iofunc_devctl_default only checks the message shape.",
    lang: "c",
    code: `chid = ChannelCreate(_NTO_CHF_FIXED_PRIORITY);
if (chid == -1) return EXIT_FAILURE;
dpp = dispatch_create_channel(chid, 0);
id = resmgr_attach(dpp, &resmgr_attr, "/dev/telemetry", _FTYPE_ANY, 0,
                   &connect_funcs, &io_funcs, &attr);
if (id == -1) return EXIT_FAILURE;
secpol_transition_type(NULL, "telemetry_t", 0);`,
  },
  {
    n: "02",
    title: "Pair it with an IFS buildfile",
    body: "mkifs reads a .build file. The bootstrap block starts with startup-* and ends with procnto-smp-instr. PATH= becomes _CS_PATH, so a leading dot or an empty component is a production defect. The [+script] runs after procnto, not as a shell: no pipes, and a command without & blocks every line after it. Push the policy before any daemon. Confine each long-running process with on -T. Leave ksh and qconn out of a production image.",
    lang: "text",
    code: `[virtual=x86_64,bios +compress] boot = {
    startup-x86
    PATH=/proc/boot:/bin:/usr/bin procnto-smp-instr
}
[+script] startup-script = {
    display_msg "ChannelCheck hardened baseline"
    secpolpush
    on -T telemetry_t telemetry_rm &
}`,
  },
  {
    n: "03",
    title: "Write a least-privilege secpol",
    body: "secpolcompile turns this text into secpol.bin. Declare every type you launch. allow_attach names the path a type may claim. allow client server:channel connect is the rule a MsgSend needs. Do not grant PROCMGR_AID_ROOT, mem_phys, or able_priv to an ordinary daemon. A wildcard allow is not a policy.",
    lang: "text",
    code: `type telemetry_t;
type telemetry_client_t;
allow_attach telemetry_t /dev/telemetry;
allow telemetry_client_t telemetry_t:channel connect;
allow telemetry_t self:ability { spawn prot_exec };`,
  },
  {
    n: "04",
    title: "Plant a real deadlock and a privilege leak",
    body: "Open the ADAS sensor bus sample. sensor_rm and fusion are both single-threaded resource managers. Each io_devctl calls open() on the other path and then MsgSend. MsgSend does not return until MsgReply, and the only thread that can reply is blocked in that MsgSend. The policy grants fusion_t PROCMGR_AID_ROOT and a wildcard allow. The buildfile starts the daemons, then ksh, and only then secpolpush.",
    lang: "c",
    code: `fd = open("/dev/adas/fusion", O_RDWR);
MsgSend(fd, &frame, sizeof frame, &frame, sizeof frame);`,
  },
  {
    n: "05",
    title: "Catch it with ChannelCheck and apply the fix",
    body: "From the repo root, scan the sample. The workbench draws the same graph: process nodes, secpol type boundaries, and a glowing cycle on the synchronous edges. Apply safe fixes. One MsgSend becomes MsgSendPulse, channels gain _NTO_CHF_FIXED_PRIORITY, handlers check credentials, secpolpush moves ahead of the daemons, ksh and qconn leave the image, and the root abilities are deleted. Scan again. Critical findings are gone. Run the same gate in CI with a non-zero exit.",
    lang: "bash",
    code: `npx channelcheck scan examples/adas-sensor-bus
npx channelcheck fix examples/adas-sensor-bus --dry-run
npx channelcheck ci examples/adas-sensor-bus   # exits 1
npx channelcheck ci examples/hardened-baseline # exits 0`,
  },
  {
    n: "06",
    title: "Build and boot on QNX SDP 8.0 QEMU",
    body: "ChannelCheck itself is a host tool. It does not need qcc. The samples are real SDP 8.0 projects. On a machine where you have sourced qnxsdp-env.sh, build the x86_64 image and the aarch64le image, compile the policy, and boot QEMU. This repository's Linux CI does not have qcc or QEMU installed, so those commands are not claimed as executed output.",
    lang: "bash",
    code: `. /opt/qnx800/qnxsdp-env.sh
make -C examples/adas-sensor-bus CPU=x86_64
make -C examples/infusion-pump CPU=aarch64le
sh scripts/qemu-x86_64.sh examples/adas-sensor-bus/adas.ifs
sh scripts/qemu-aarch64le.sh examples/infusion-pump/pump.ifs`,
  },
];
