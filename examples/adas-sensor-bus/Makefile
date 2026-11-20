# QNX SDP 8.0 — ADAS sensor bus
# Host analysis does not need this file. qcc/mkifs/secpolcompile come from qnxsdp-env.sh.
QCC ?= qcc
MKIFS ?= mkifs
SECPOLCOMPILE ?= secpolcompile
CPU ?= x86_64

ifeq ($(CPU),aarch64le)
QCC_V := gcc_ntoaarch64le
else
QCC_V := gcc_ntox86_64
endif

.PHONY: all ifs clean
all: sensor_rm fusion ifs

sensor_rm: sensor_rm.c adas_proto.h
	$(QCC) -V$(QCC_V) -Wall -Wextra -o $@ sensor_rm.c

fusion: fusion.c adas_proto.h
	$(QCC) -V$(QCC_V) -Wall -Wextra -o $@ fusion.c

adas.secpol.bin: adas.secpol
	$(SECPOLCOMPILE) -o $@ adas.secpol

ifs: sensor_rm fusion adas.secpol.bin adas.build
	$(MKIFS) adas.build adas.ifs

clean:
	rm -f sensor_rm fusion adas.ifs adas.secpol.bin
