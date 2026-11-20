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
all: telemetry_rm telemetry_client ifs

telemetry_rm: telemetry_rm.c
	$(QCC) -V$(QCC_V) -Wall -Wextra -o $@ telemetry_rm.c

telemetry_client: telemetry_client.c
	$(QCC) -V$(QCC_V) -Wall -Wextra -o $@ telemetry_client.c

telemetry.secpol.bin: telemetry.secpol
	$(SECPOLCOMPILE) -o $@ telemetry.secpol

ifs: telemetry_rm telemetry_client telemetry.secpol.bin telemetry.build
	$(MKIFS) telemetry.build telemetry.ifs

clean:
	rm -f telemetry_rm telemetry_client telemetry.ifs telemetry.secpol.bin
