import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'
import type { SpawnOptions } from 'node:child_process'
import { resolve } from 'path'

/** Keep Vite's Electron launch equivalent to `electron .`. */
export const electronDevArgv = (): string[] => ['.']

/** Build an isolated child environment for the machine-local GPU preference. */
export const electronDevEnvironment = (
  environment: NodeJS.ProcessEnv,
  disableHardwareAcceleration: boolean,
): NodeJS.ProcessEnv => {
  const childEnvironment = { ...environment }
  if (disableHardwareAcceleration) {
    childEnvironment.AGENT_PETS_DISABLE_GPU = '1'
  } else {
    delete childEnvironment.AGENT_PETS_DISABLE_GPU
  }
  return childEnvironment
}

const createElectronStarter = (disableHardwareAcceleration: boolean) => ({
  startup,
}: {
  startup: (argv?: string[], options?: SpawnOptions) => Promise<boolean>
}) => {
  // vite-plugin-electron otherwise appends --no-sandbox. Agent Pets already
  // supports Chromium sandboxing and should use the same argv as `electron .`.
  // The GPU fallback is machine-local and is never exposed to the renderer.
  void startup(electronDevArgv(), {
    env: electronDevEnvironment(process.env, disableHardwareAcceleration),
  })
}

export default defineConfig(({ mode }) => {
  const localEnvironment = loadEnv(mode, import.meta.dirname, 'AGENT_PETS_')
  const startElectron = createElectronStarter(
    localEnvironment.AGENT_PETS_DISABLE_GPU === '1',
  )

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
          // build, so both build entries must override its default argv.
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
