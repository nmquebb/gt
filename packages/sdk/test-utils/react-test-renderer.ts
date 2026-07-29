import { afterAll, afterEach, beforeAll } from "bun:test";
import type { ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

export function createReactTestHarness() {
  const renderers: ReactTestRenderer[] = [];
  let originalConsoleError: typeof console.error = console.error;

  beforeAll(() => {
    originalConsoleError = console.error;
    console.error = (message?: unknown, ...rest: unknown[]) => {
      if (
        typeof message === "string" &&
        message.includes("react-test-renderer is deprecated")
      ) {
        return;
      }
      originalConsoleError(message, ...rest);
    };
  });

  afterEach(async () => {
    await act(async () => {
      for (const renderer of renderers.splice(0)) {
        renderer.unmount();
      }
    });
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });

  async function render(element: ReactElement) {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(element);
    });
    renderers.push(renderer);
    return renderer;
  }

  return { render, textContent };
}

export function textContent(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textContent).join("");
  }
  if (typeof value === "object" && value !== null && "props" in value) {
    return textContent(
      (value as { props?: { children?: unknown } }).props?.children,
    );
  }
  if (typeof value === "object" && value !== null && "children" in value) {
    return textContent((value as { children?: unknown }).children);
  }
  return "";
}
