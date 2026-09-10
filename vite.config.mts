import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'
import type { SpawnOptions } from 'node:child_process'
import { resolve } from 'path'

export const GPU_SAFE_DEV_MODE = 'gpu-safe'

/** Keep Vite's Electron launch equivalent to `electron .`. */
export const electronDevArgv = (): string[] => ['.']

/** Build an isolated child environment for the selected development mode. */
export const electronDevEnvironment = (
  environment: NodeJS.ProcessEnv,
  gpuSafeMode: boolean,
): NodeJS.ProcessEnv => {
  const childEnvironment = { ...environment }
  if (gpuSafeMode) {
    childEnvironment.AGENT_PETS_GPU_SAFE_MODE = '1'
  } else {
    delete childEnvironment.AGENT_PETS_GPU_SAFE_MODE
  }
  return childEnvironment
}

const createElectronStarter = (gpuSafeMode: boolean) => ({
  startup,
}: {
  startup: (argv?: string[], options?: SpawnOptions) => Promise<boolean>
}) => {
  // vite-plugin-electron otherwise appends --no-sandbox. Agent Pets already
  // supports Chromium sandboxing and should use the same argv as `electron .`.
  void startup(electronDevArgv(), {
    env: electronDevEnvironment(process.env, gpuSafeMode),
  })
}

export default defineConfig(({ mode }) => {
  const startElectron = createElectronStarter(mode === GPU_SAFE_DEV_MODE)

  return {
    plugins: [
      vue(),
      electron({
        main: {
          entry: 'electron/main.ts',
          onstart: startElectron,
        },
        preload: {
          input: 'electron/preload.ts',
          // The simple plugin may perform the initial launch from the preload
          // build, so both entries must override the default startup argv.
          onstart: startElectron,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': resolve(import.meta.dirname, 'src'),
      },
    },
  }
})
