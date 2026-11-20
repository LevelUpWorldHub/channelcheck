# Demo script — under 2:45

Record the workbench full screen, dark theme, 1920×1080. Start `npm run dev` and leave the ADAS workspace on screen before you hit record, then reload once as the video starts so the load is visible. Do not show a terminal transcript from `qcc`. It was not run.

| Time | On screen | Say |
| --- | --- | --- |
| 0:00–0:12 | Title card: ChannelCheck, QNX SDP 8.0. Cut to the score bar, already on ADAS, posture exposed. | "QNX 8 boots from three files: the IFS buildfile, the security policy, and the C that calls MsgSend. ChannelCheck reads all three." |
| 0:12–0:32 | Cursor moves across the file list: `adas.build`, `adas.secpol`, `sensor_rm.c`, `fusion.c`. Hover the score. | "This is an ADAS sensor bus, broken the way a real image gets broken. The score is the opened image. Nothing has been fixed yet." |
| 0:32–1:05 | Graph. Trace the red edge from `sensor_rm` to `fusion` and back. Click the deadlock finding. The card shows the `MsgSend` line. | "Both resource managers are single-threaded. Each io_devctl MsgSends into the other. MsgSend waits for MsgReply, and the only thread that can reply is stuck in that send. The red cycle is that wait." |
| 1:05–1:35 | Click the wildcard finding, then `PROCMGR_AID_ROOT`. Open Timeline. Point at `ksh`, then `secpolpush` at the bottom. | "The policy allows sensor_t to do anything, and fusion_t holds root. The boot script starts the daemons, starts ksh, and only then pushes the policy. Those processes never see it." |
| 1:35–2:05 | Click **Apply safe fixes**. Hold on the score jumping and the red edges disappearing. Scroll the diff so `MsgSendPulse` and the deleted root ability are both visible. Point at Critical 0. | "One click. The cycle edge becomes a pulse, so it no longer waits. secpolpush moves ahead of the daemons. Root, ksh, and the setuid bit come out. Rescan: zero critical findings." |
| 2:05–2:25 | Codelab tab, step 6. Then a quick cut to the hardened baseline, score 100, posture locked. | "The codelab is the same path: write the resource manager, the buildfile, and the policy, then build with qcc for x86_64 or aarch64le and boot QEMU. The analyzer is what we ran. The image build is the SDP command, on a machine that has qcc." |
| 2:25–2:40 | Four workspaces in the menu, then the ChannelCheck wordmark. | "Host tool. Linux, macOS, Windows. Apache-2.0. The deadlock was in the QNX IPC, and the fix is in the image." |

Total: 2:40.
