import { create } from "react-test-renderer";

const originalConsoleError = console.error;
let activeTestFiles = 0;

function isKnownTestRendererWarning(message: unknown): boolean {
  return (
    message ===
    "react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer"
  );
}

function filteredConsoleError(message?: unknown, ...arguments_: unknown[]) {
  if (isKnownTestRendererWarning(message)) {
    return;
  }
  originalConsoleError(message, ...arguments_);
}

export function installTestRendererWarningFilter(): void {
  activeTestFiles += 1;
  console.error = filteredConsoleError;
}

export function restoreTestRendererWarningFilter(): void {
  activeTestFiles -= 1;
  if (activeTestFiles === 0) {
    console.error = originalConsoleError;
  }
}

export function createTestRenderer(element: Parameters<typeof create>[0]) {
  return create(element);
}
