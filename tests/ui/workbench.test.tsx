// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../../web/src/App";

describe("workbench", () => {
  it("opens the broken ADAS workspace, clears the deadlock, and keeps the codelab", () => {
    const view = render(<App />);
    expect(screen.getAllByText("Synchronous MsgSend deadlock cycle").length).toBeGreaterThan(0);
    expect(view.container.querySelector('[data-cycle="true"]')).toBeTruthy();
    expect(screen.getByTestId("critical-count").textContent).not.toBe("0");
    expect(screen.getByTestId("finding-line").textContent).toContain("MsgSend");

    fireEvent.click(screen.getByRole("button", { name: "Apply safe fixes" }));

    expect(screen.getByTestId("critical-count").textContent).toBe("0");
    expect(screen.getByTestId("error-count").textContent).toBe("0");
    expect(view.container.querySelector('[data-cycle="true"]')).toBeNull();
    expect(screen.getByTestId("fix-diff").textContent).toContain("MsgSendPulse");

    fireEvent.click(screen.getByRole("tab", { name: "Codelab" }));
    expect(screen.getByTestId("codelab").textContent).toContain("Six steps");
    expect(screen.getByText("Build and boot on QNX SDP 8.0 QEMU")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Toggle color theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.change(screen.getByLabelText("Workspace"), { target: { value: "hardened-baseline" } });
    expect(screen.getByTestId("critical-count").textContent).toBe("0");
    expect(screen.getByText(/fixed-priority channel/i)).toBeTruthy();
  });
});
