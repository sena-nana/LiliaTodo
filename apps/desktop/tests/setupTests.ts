import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/vue";
import { afterEach, expect, vi } from "vitest";

expect.extend(matchers);

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
