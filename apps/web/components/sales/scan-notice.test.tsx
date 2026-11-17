import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { ScanNoticeBar } from "./scan-notice";

describe("ScanNoticeBar", () => {
  it("shows why the read failed, announced to screen readers", () => {
    render(<ScanNoticeBar notice={{ code: "0001", message: "Nenhum produto com o código 0001" }} onDismiss={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Nenhum produto com o código 0001");
  });

  it("can be dismissed", () => {
    const onDismiss = vi.fn();
    render(<ScanNoticeBar notice={{ code: "0001", message: "x" }} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));

    expect(onDismiss).toHaveBeenCalled();
  });

  it("renders nothing without a notice", () => {
    render(<ScanNoticeBar notice={null} onDismiss={vi.fn()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
