QCC ?= qcc
MKIFS ?= mkifs
SECPOLCOMPILE ?= secpolcompile
CPU ?= aarch64le

ifeq ($(CPU),x86_64)
QCC_V := gcc_ntox86_64
else
QCC_V := gcc_ntoaarch64le
endif

.PHONY: all ifs clean
all: pump_rm clinician_ui ifs

pump_rm: pump_rm.c
	$(QCC) -V$(QCC_V) -Wall -Wextra -o $@ pump_rm.c

clinician_ui: clinician_ui.c
	$(QCC) -V$(QCC_V) -Wall -Wextra -o $@ clinician_ui.c

pump.secpol.bin: pump.secpol
	$(SECPOLCOMPILE) -o $@ pump.secpol

ifs: pump_rm clinician_ui pump.secpol.bin pump.build
	$(MKIFS) pump.build pump.ifs

clean:
	rm -f pump_rm clinician_ui pump.ifs pump.secpol.bin
