# Host targets use Node. QNX targets need QNX SDP 8.0 on PATH (qnxsdp-env.sh).
.PHONY: test typecheck build scan-adas scan-clean

test:
	npm test

typecheck:
	npm run typecheck

build:
	npm run build

scan-adas:
	npx tsx src/cli/index.ts scan examples/adas-sensor-bus

scan-clean:
	npx tsx src/cli/index.ts ci examples/hardened-baseline

# SDP 8.0 examples. These fail clearly when qcc is absent.
qnx-x86_64:
	$(MAKE) -C examples/hardened-baseline CPU=x86_64
	$(MAKE) -C examples/adas-sensor-bus CPU=x86_64
	$(MAKE) -C examples/factory-plc CPU=x86_64

qnx-aarch64le:
	$(MAKE) -C examples/infusion-pump CPU=aarch64le
	$(MAKE) -C examples/hardened-baseline CPU=aarch64le
