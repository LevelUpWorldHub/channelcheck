#!/bin/sh
# Boot a QNX SDP 8.0 aarch64le raw IFS (mkifs virtual=aarch64le,raw).
# Not run by ChannelCheck CI: this host does not ship qcc or QEMU.
set -eu
IMAGE=${1:-}
if ! command -v qcc >/dev/null 2>&1; then
  echo "qcc is not on PATH."
  echo "Source QNX SDP 8.0 first, for example: . /opt/qnx800/qnxsdp-env.sh"
  echo "ChannelCheck's Linux checks analyze sources. They do not boot this image."
  exit 1
fi
if [ -z "$IMAGE" ] || [ ! -f "$IMAGE" ]; then
  echo "Usage: sh scripts/qemu-aarch64le.sh path/to/image.ifs"
  exit 1
fi
if ! command -v qemu-system-aarch64 >/dev/null 2>&1; then
  echo "qemu-system-aarch64 is not installed."
  exit 1
fi
exec qemu-system-aarch64 -M virt -cpu cortex-a72 -smp 2 -m 512 -nographic \
  -kernel "$IMAGE"
