import type { Finding, RuleMeta, Severity } from "./types.js";

export const RULES: RuleMeta[] = [
  {
    id: "QNX-IFS-SECPOL-MISSING",
    title: "Security policy is never pushed",
    severity: "error",
    fixable: true,
    rationale:
      "QNX 8.0 does not enforce a security policy until secpolpush loads /proc/boot/secpol.bin into procnto. An IFS script that never calls secpolpush leaves every process untyped.",
    remediation: "Insert secpolpush immediately after the script prologue (display_msg / procmgr_symlink) and before any daemon.",
  },
  {
    id: "QNX-IFS-SECPOL-ORDER",
    title: "Daemon starts before secpolpush",
    severity: "error",
    fixable: true,
    rationale:
      "Types are applied at spawn with on -T. A process started before secpolpush is already running when the policy arrives, so the type is never attached.",
    remediation: "Move secpolpush above the first non-prologue command in the [+script] block.",
  },
  {
    id: "QNX-IFS-POLICY-BLOB",
    title: "Compiled policy is not in the IFS",
    severity: "error",
    fixable: true,
    rationale:
      "secpolpush defaults to /proc/boot/secpol.bin. If mkifs never places that file in the image, the push fails and the system boots with no policy.",
    remediation: "Add [uid=0 gid=0 perms=0644] /proc/boot/secpol.bin = secpol.bin to the buildfile.",
  },
  {
    id: "QNX-IFS-UNCONFINED-ROOT",
    title: "Root daemon launched without a security type",
    severity: "error",
    fixable: true,
    rationale:
      "Without on -T <type>, procnto starts the process as an untyped root principal. Untyped root is outside the allow rules you wrote in the .secpol file.",
    remediation: "Launch the daemon with on -T <type> (and a non-zero uid when it does not need root).",
  },
  {
    id: "QNX-IFS-UNCONFINED",
    title: "Process launched without a security type",
    severity: "warning",
    fixable: true,
    rationale:
      "A non-root process without on -T is still untyped. Channel connects and resmgr attaches then fail closed, or worse, match an unintended default rule.",
    remediation: "Prefix the command with on -T <type>.",
  },
  {
    id: "QNX-IFS-SETUID",
    title: "Setuid or setgid bit in the IFS",
    severity: "error",
    fixable: true,
    rationale:
      "A setuid binary in /proc/boot runs as root regardless of the account that execs it. On a QNX 8 image that is the boot filesystem, that is a permanent privilege escalation path.",
    remediation: "Drop the setuid/setgid bits (4755 → 0755). Grant a specific procmgr ability instead.",
  },
  {
    id: "QNX-IFS-WORLD-WRITABLE",
    title: "World-writable IFS object",
    severity: "error",
    fixable: true,
    rationale:
      "perms with the other-write bit set (anything ending in 2, 3, 6, or 7) lets every process rewrite a file that lives in the boot image or its inline data.",
    remediation: "Clear the other-write bit (0666 → 0664, 0777 → 0775).",
  },
  {
    id: "QNX-IFS-UNSAFE-PATH",
    title: "Unsafe PATH in the boot image",
    severity: "error",
    fixable: true,
    rationale:
      "The bootstrap PATH becomes _CS_PATH for every process. An empty component, a literal dot, or /tmp lets a writable directory supply binaries that run as root during startup.",
    remediation: "Use an absolute PATH such as /proc/boot:/bin:/usr/bin with no empty or relative components.",
  },
  {
    id: "QNX-IFS-DEBUG-SHELL",
    title: "Debug shell or qconn shipped in the image",
    severity: "error",
    fixable: true,
    rationale:
      "ksh and qconn are development backdoors. qconn exposes the QNX debug agent; a shell in the production IFS gives anyone who can reach the console an untyped root prompt.",
    remediation: "Remove ksh, qconn, and symlinks to them from the production buildfile.",
  },
  {
    id: "QNX-IFS-DUPLICATE-TARGET",
    title: "Duplicate IFS target path",
    severity: "error",
    fixable: true,
    rationale:
      "mkifs rejects two entries with the same target path unless +dupignore is set, in which case one of them is silently dropped. Either way the image you think you built is not the image you get.",
    remediation: "Keep a single entry for the target path.",
  },
  {
    id: "QNX-IFS-FOREGROUND",
    title: "Daemon started in the foreground",
    severity: "error",
    fixable: true,
    rationale:
      "The IFS script is a single thread. A long-running process without & never returns, so every later line — including secpolpush, waitfor, and reopen — is skipped.",
    remediation: "Background the daemon with &.",
  },
  {
    id: "QNX-IFS-BOOTSTRAP",
    title: "Bootstrap is missing startup or procnto",
    severity: "error",
    fixable: true,
    rationale:
      "A bootable QNX 8 image is a [virtual=...] block whose first executable is startup-* and which contains procnto (procnto-smp-instr on SMP systems). Without both, the board never reaches the script.",
    remediation: "Open the image with startup-* and procnto-smp-instr inside the virtual bootstrap.",
  },
  {
    id: "QNX-IFS-BOOT-ORDER",
    title: "Device node used before its driver",
    severity: "warning",
    fixable: false,
    rationale:
      "reopen and clients that touch /dev/ser* before devc-* start will block in stat() until the wait timeout, and the console redirect then points at a node that does not exist yet.",
    remediation: "Start the driver, then waitfor the node, then reopen it.",
  },
  {
    id: "QNX-SEC-WILDCARD",
    title: "Wildcard allow or attach-any rule",
    severity: "critical",
    fixable: true,
    rationale:
      "An allow rule with * in the type, class, or permission position, or allow_attach of /..., grants a type every operation the policy compiler knows about. That erases the least-privilege model QNX 8 secpol exists to provide.",
    remediation: "Replace the wildcard with an explicit allow <client> <server>:channel connect and a specific allow_attach path.",
  },
  {
    id: "QNX-SEC-BROAD-ATTACH",
    title: "Broad allow_attach wildcard",
    severity: "warning",
    fixable: false,
    rationale:
      "allow_attach paths may use * inside one directory. A pattern such as /dev/socket/* is sometimes legitimate, but it still exposes every name under that prefix.",
    remediation: "Narrow the pattern to the device nodes the resource manager actually registers.",
  },
  {
    id: "QNX-SEC-ROOT-ABILITY",
    title: "Root ability granted to a type",
    severity: "critical",
    fixable: true,
    rationale:
      "PROCMGR_AID_ROOT (and the short name root) hands the type unrestricted process-manager power. A single resource manager with that ability can undo the rest of the policy.",
    remediation: "Delete the root ability. Keep only the abilities the process calls.",
  },
  {
    id: "QNX-SEC-PHYS-MEM",
    title: "Physical-memory ability granted",
    severity: "error",
    fixable: true,
    rationale:
      "PROCMGR_AID_MEM_PHYS / mem_phys lets a process map physical addresses. On a safety image that is arbitrary MMIO and kernel memory, not a routine driver privilege.",
    remediation: "Remove mem_phys unless the driver maps a named, bounded range you have reviewed.",
  },
  {
    id: "QNX-SEC-ABLE-PRIV",
    title: "Ability to mint privileges",
    severity: "error",
    fixable: true,
    rationale:
      "PROCMGR_AID_ABLE_PRIV / able_priv lets a process grant itself abilities it was not given. That is a policy bypass.",
    remediation: "Remove able_priv. List the concrete abilities instead.",
  },
  {
    id: "QNX-SEC-UNDECLARED-TYPE",
    title: "Policy rule references an undeclared type",
    severity: "error",
    fixable: true,
    rationale:
      "secpolcompile requires every type to be introduced with a type statement. An undeclared name is a compile error, or a typo that silently fails to confine the process you meant.",
    remediation: "Add type <name>; before the rule that uses it.",
  },
  {
    id: "QNX-SEC-ORPHAN-TYPE",
    title: "Buildfile type is missing from the policy",
    severity: "error",
    fixable: true,
    rationale:
      "on -T names a type that must exist in the compiled policy. If the type was never declared, the spawn fails or the process is left untyped.",
    remediation: "Declare the type and give it the minimum allow and allow_attach rules it needs.",
  },
  {
    id: "QNX-SEC-DANGLING-TYPE",
    title: "Policy type is never referenced",
    severity: "warning",
    fixable: true,
    rationale:
      "A type statement that no rule, no on -T launch, and no secpol_transition_type() call mentions is leftover privilege surface. Reviewers cannot tell whether it was meant to be confined.",
    remediation: "Delete the unused type, or apply it to the process that needs it.",
  },
  {
    id: "QNX-SEC-UNAPPLIED-TYPE",
    title: "allow_attach type is never launched",
    severity: "warning",
    fixable: true,
    rationale:
      "The policy permits a type to own a path, but the IFS script never starts a process with on -T of that type. The path is either unprotected at runtime or the server fails to attach.",
    remediation: "Start the resource manager with on -T <type>.",
  },
  {
    id: "QNX-SEC-MISSING-ALLOW",
    title: "IPC edge has no channel connect rule",
    severity: "warning",
    fixable: true,
    rationale:
      "QNX 8 denies ConnectAttach / name_open between two typed processes unless the policy has allow <client> <server>:channel connect (or allow_channel). The call fails at runtime with EACCES.",
    remediation: "Add an allow rule for that one direction only.",
  },
  {
    id: "QNX-SEC-LINK-TMP",
    title: "allow_link targets a writable path",
    severity: "warning",
    fixable: true,
    rationale:
      "allow_link permits pathmgr_symlink() and pathmgr_link(). Pointing that at /tmp lets the type retarget a name onto a world-writable directory.",
    remediation: "Delete the allow_link or point it at a root-owned path.",
  },
  {
    id: "QNX-IPC-DEADLOCK",
    title: "Synchronous MsgSend deadlock cycle",
    severity: "critical",
    fixable: true,
    rationale:
      "MsgSend blocks the caller until MsgReply. A single-threaded resource manager cannot reply while its handler is stuck in MsgSend. If two servers each send to the other — or a server sends to itself — both threads wait forever.",
    remediation:
      "Break the cycle: one direction must be MsgSendPulse (asynchronous) or run on a second thread that is not the receive thread.",
  },
  {
    id: "QNX-IPC-PRIORITY-INVERSION",
    title: "Server channel is not fixed-priority",
    severity: "error",
    fixable: true,
    rationale:
      "Without _NTO_CHF_FIXED_PRIORITY, the receive thread adopts the sender's priority. A high-criticality server (FIFO, priority ≥ 20, or a safety comment) then runs at a low client's priority, which is priority inversion on a Neutrino channel.",
    remediation: "Create the channel with ChannelCreate(_NTO_CHF_FIXED_PRIORITY) and pass that chid to dispatch_create_channel().",
  },
  {
    id: "QNX-IPC-IMPLICIT-CHANNEL",
    title: "dispatch_create() hides the channel flags",
    severity: "error",
    fixable: true,
    rationale:
      "dispatch_create() allocates a channel you cannot pass _NTO_CHF_FIXED_PRIORITY to. High-criticality servers must own the channel explicitly.",
    remediation: "ChannelCreate(_NTO_CHF_FIXED_PRIORITY), then dispatch_create_channel(chid, 0).",
  },
  {
    id: "QNX-IPC-UNCHECKED-SEND",
    title: "MsgSend return value ignored",
    severity: "error",
    fixable: true,
    rationale:
      "MsgSend and MsgSendv return -1 and set errno when the server died, the type was denied, or the reply was an error. Ignoring that publishes a stale sensor frame or actuator command.",
    remediation: "Branch on -1 before using the reply buffer.",
  },
  {
    id: "QNX-IPC-UNCHECKED-CONNECT",
    title: "ConnectAttach return value ignored",
    severity: "error",
    fixable: true,
    rationale:
      "ConnectAttach returns -1 when the channel id is wrong or the policy denies channel connect. A later MsgSend on that coid then targets whatever happened to be on the stack.",
    remediation: "Test the coid against -1 before sending.",
  },
  {
    id: "QNX-IPC-UNCHECKED-CHANNEL",
    title: "ChannelCreate return value ignored",
    severity: "warning",
    fixable: true,
    rationale:
      "ChannelCreate returns -1 on failure. dispatch_create_channel() on a bad chid aborts the resource manager at boot with a misleading error.",
    remediation: "Check the chid before attaching a dispatch or resmgr path.",
  },
  {
    id: "QNX-IPC-UNGUARDED-RESMGR",
    title: "Resource-manager handler has no authorization check",
    severity: "error",
    fixable: true,
    rationale:
      "iofunc_devctl_default only checks the message shape. An io_open or io_devctl that never looks at ctp->info.cred, secpol_check_permission, or iofunc_check_access performs privileged work for every client that can open the path.",
    remediation: "Reject the message when the caller fails an explicit credential, ability, or secpol check.",
  },
  {
    id: "QNX-IPC-UNRESOLVED-TARGET",
    title: "MsgSend target is not a resmgr in this workspace",
    severity: "warning",
    fixable: false,
    rationale:
      "The analyzer could not match the coid to a path registered with resmgr_attach or name_attach in the scanned sources. The edge is missing from the deadlock graph.",
    remediation: "Open the server path with name_open() or open(), or annotate the ConnectAttach with @channelcheck-target: /dev/...",
  },
  {
    id: "QNX-PARSE",
    title: "File could not be parsed",
    severity: "warning",
    fixable: false,
    rationale: "The analyzer hit a construct it does not understand and skipped part of the file rather than inventing findings.",
    remediation: "Check the line against the QNX 8 mkifs or secpol grammar.",
  },
];

const BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

export function rule(id: string): RuleMeta {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown rule ${id}`);
  return found;
}

let seq = 0;

export function makeFinding(
  ruleId: string,
  file: string,
  line: number,
  message: string,
  extra?: { severity?: Severity; column?: number; endLine?: number; fixable?: boolean },
): Finding {
  const meta = rule(ruleId);
  seq += 1;
  return {
    id: `${ruleId}:${file}:${line}:${seq}`,
    ruleId,
    severity: extra?.severity ?? meta.severity,
    title: meta.title,
    message,
    rationale: meta.rationale,
    remediation: meta.remediation,
    file,
    line,
    column: extra?.column ?? 1,
    endLine: extra?.endLine ?? line,
    fixable: extra?.fixable ?? meta.fixable,
  };
}

export function resetFindingIds(): void {
  seq = 0;
}
