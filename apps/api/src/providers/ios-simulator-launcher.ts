import { Result, type Result as ResultType } from "better-result";

export class SimulatorLaunchFailure extends Error {}

export interface IosSimulatorLauncher {
  open(deepLink: string): Promise<ResultType<void, SimulatorLaunchFailure>>;
}

export class BunIosSimulatorLauncher implements IosSimulatorLauncher {
  async open(
    deepLink: string,
  ): Promise<ResultType<void, SimulatorLaunchFailure>> {
    const spawned = await Result.tryPromise({
      try: async () =>
        Bun.spawn(["bunx", "uri-scheme", "open", deepLink, "--ios"], {
          stdout: "pipe",
          stderr: "pipe",
        }),
      catch: () => new SimulatorLaunchFailure(),
    });
    if (Result.isError(spawned)) {
      return Result.err(spawned.error);
    }

    const exited = await Result.tryPromise({
      try: () => spawned.value.exited,
      catch: () => new SimulatorLaunchFailure(),
    });
    if (Result.isError(exited) || exited.value !== 0) {
      return Result.err(
        Result.isError(exited) ? exited.error : new SimulatorLaunchFailure(),
      );
    }

    return Result.ok(undefined);
  }
}
