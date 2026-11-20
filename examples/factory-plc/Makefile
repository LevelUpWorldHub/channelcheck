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
all: plc_cell supervisor ifs

plc_cell: plc_cell.c
	$(QCC) -V$(QCC_V) -Wall -Wextra -o $@ plc_cell.c

supervisor: supervisor.c
	$(QCC) -V$(QCC_V) -Wall -Wextra -o $@ supervisor.c

plc.secpol.bin: plc.secpol
	$(SECPOLCOMPILE) -o $@ plc.secpol

ifs: plc_cell supervisor plc.secpol.bin plc.build
	$(MKIFS) plc.build plc.ifs

clean:
	rm -f plc_cell supervisor plc.ifs plc.secpol.bin
