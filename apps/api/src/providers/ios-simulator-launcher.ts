export class SimulatorLaunchFailure extends Error {}

export interface IosSimulatorLauncher {
  open(deepLink: string): Promise<void>;
}

export class BunIosSimulatorLauncher implements IosSimulatorLauncher {
  async open(deepLink: string): Promise<void> {
    try {
      const spawned = Bun.spawn(
        ["bunx", "uri-scheme", "open", deepLink, "--ios"],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      if ((await spawned.exited) !== 0) {
        throw new SimulatorLaunchFailure();
      }
    } catch (error) {
      if (error instanceof SimulatorLaunchFailure) {
        throw error;
      }
      throw new SimulatorLaunchFailure();
    }
  }
}
