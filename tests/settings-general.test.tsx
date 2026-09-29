// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SettingsProvider } from "../src/components/settings-provider";
import { GeneralSettings } from "../src/components/settings/settings-sections";
import { ThemeProvider } from "../src/components/theme-provider";
import { installLocalStorage } from "./fake-storage";

function stubNotification(permission: NotificationPermission) {
  const requestPermission = vi.fn(async () => permission);
  vi.stubGlobal(
    "Notification",
    Object.assign(function Notification() {}, { permission, requestPermission }),
  );
  return requestPermission;
}

async function renderGeneral() {
  render(
    <ThemeProvider>
      <SettingsProvider>
        <GeneralSettings />
      </SettingsProvider>
    </ThemeProvider>,
  );
  await act(async () => {});
}

function radios(groupName: string) {
  const group = screen.getByRole("radiogroup", { name: groupName });
  return within(group)
    .getAllByRole("radio")
    .map((radio) => ({
      name: radio.getAttribute("aria-label") ?? radio.textContent,
      checked: radio.getAttribute("aria-checked"),
    }));
}

function switchState(name: string) {
  const control = screen.getByRole("switch", { name });
  return {
    checked: control.getAttribute("aria-checked"),
    disabled: control.hasAttribute("disabled") || control.getAttribute("aria-disabled") === "true",
  };
}

beforeEach(() => {
  installLocalStorage();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-motion");
  document.documentElement.classList.remove("light", "dark");
});

describe("General settings ▸ Appearance", () => {
  it("renders Theme as icon-only System/Light/Dark radios bound to the theme provider", async () => {
    stubNotification("granted");
    await renderGeneral();

    expect(radios("Theme")).toStrictEqual([
      { name: "System", checked: "true" },
      { name: "Light", checked: "false" },
      { name: "Dark", checked: "false" },
    ]);

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    expect({
      radios: radios("Theme"),
      stored: localStorage.getItem("theme"),
      dark: document.documentElement.classList.contains("dark"),
    }).toStrictEqual({
      radios: [
        { name: "System", checked: "false" },
        { name: "Light", checked: "false" },
        { name: "Dark", checked: "true" },
      ],
      stored: "dark",
      dark: true,
    });
  });

  it("sets html[data-motion=reduced] from the Motion control and clears it for System", async () => {
    stubNotification("granted");
    await renderGeneral();

    expect(radios("Motion")).toStrictEqual([
      { name: "System", checked: "true" },
      { name: "Reduced", checked: "false" },
    ]);

    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Motion" })).getByText("Reduced"),
    );
    const reduced = {
      attribute: document.documentElement.getAttribute("data-motion"),
      stored: localStorage.getItem("ccp-motion"),
    };

    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Motion" })).getByText("System"));

    expect({
      reduced,
      system: document.documentElement.getAttribute("data-motion"),
    }).toStrictEqual({
      reduced: { attribute: "reduced", stored: "reduced" },
      system: null,
    });
  });

  it("applies a stored reduced motion preference on load", async () => {
    stubNotification("granted");
    localStorage.setItem("ccp-motion", "reduced");
    await renderGeneral();

    expect(document.documentElement.getAttribute("data-motion")).toBe("reduced");
  });
});

describe("General settings ▸ Notifications", () => {
  it("shows completions on and permission requests off by default once permission is granted", async () => {
    stubNotification("granted");
    await renderGeneral();

    expect({
      completions: switchState("Response completions"),
      permissionRequests: switchState("Code permission requests"),
    }).toStrictEqual({
      completions: { checked: "true", disabled: false },
      permissionRequests: { checked: "false", disabled: false },
    });
  });

  it("shows both off until the browser grants permission, then asks on toggle", async () => {
    const requestPermission = stubNotification("default");
    await renderGeneral();

    const before = {
      completions: switchState("Response completions"),
      permissionRequests: switchState("Code permission requests"),
    };
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Code permission requests" }));
    });

    expect({ before, requested: requestPermission.mock.calls.length }).toStrictEqual({
      before: {
        completions: { checked: "false", disabled: false },
        permissionRequests: { checked: "false", disabled: false },
      },
      requested: 1,
    });
  });

  it("migrates the old desktop notifications key into both new switches", async () => {
    stubNotification("granted");
    localStorage.setItem("ccp-desktop-notifications", "true");
    await renderGeneral();

    expect({
      completions: switchState("Response completions"),
      permissionRequests: switchState("Code permission requests"),
      legacy: localStorage.getItem("ccp-desktop-notifications"),
    }).toStrictEqual({
      completions: { checked: "true", disabled: false },
      permissionRequests: { checked: "true", disabled: false },
      legacy: null,
    });
  });

  it("keeps the blocked-state copy and disables both switches when notifications are denied", async () => {
    stubNotification("denied");
    await renderGeneral();

    expect({
      completions: switchState("Response completions"),
      permissionRequests: switchState("Code permission requests"),
      blocked: screen.getAllByText(
        "Notifications are blocked. Allow them for this site in your browser settings to enable.",
      ).length,
    }).toStrictEqual({
      completions: { checked: "false", disabled: true },
      permissionRequests: { checked: "false", disabled: true },
      blocked: 1,
    });
  });
});
