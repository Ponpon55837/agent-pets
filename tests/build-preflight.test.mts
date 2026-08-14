import assert from 'node:assert/strict'
import test from 'node:test'

import { isProjectAgentPetsProcess } from '../scripts/stop-agent-pets.mjs'

const workspace = 'C:\\Users\\dgh\\Desktop\\agent-pets'

test('build preflight matches the unpacked project Agent Pets executable', () => {
  assert.match(
    isProjectAgentPetsProcess(
      {
        ProcessId: 123,
        ExecutablePath: `${workspace}\\release\\win-unpacked\\Agent Pets.exe`,
        CommandLine: '"C:\\Users\\dgh\\Desktop\\agent-pets\\release\\win-unpacked\\Agent Pets.exe"',
      },
      workspace,
    ) ?? '',
    /release\/win-unpacked/i,
  )
})

test('build preflight matches the workspace Electron development process', () => {
  assert.equal(
    isProjectAgentPetsProcess(
      {
        ProcessId: 456,
        ExecutablePath: `${workspace}\\node_modules\\electron\\dist\\electron.exe`,
        CommandLine: `"${workspace}\\node_modules\\electron\\dist\\electron.exe" .`,
      },
      workspace,
    ),
    'workspace Electron process',
  )
})

test('build preflight matches the project portable executable', () => {
  assert.equal(
    isProjectAgentPetsProcess(
      {
        ProcessId: 654,
        ExecutablePath: `${workspace}\\release\\AgentPets-0.8.0.exe`,
        CommandLine: `"${workspace}\\release\\AgentPets-0.8.0.exe"`,
      },
      workspace,
    ),
    'release portable AgentPets executable',
  )
})

test('build preflight does not stop unrelated Electron processes', () => {
  assert.equal(
    isProjectAgentPetsProcess(
      {
        ProcessId: 789,
        ExecutablePath: 'C:\\Program Files\\Electron\\electron.exe',
        CommandLine: '"C:\\Users\\dgh\\Desktop\\another-project\\node_modules\\electron\\dist\\electron.exe" .',
      },
      workspace,
    ),
    null,
  )
})

test('build preflight does not treat another project portable build as owned', () => {
  assert.equal(
    isProjectAgentPetsProcess(
      {
        ProcessId: 987,
        ExecutablePath: 'C:\\Users\\dgh\\Desktop\\another-project\\release\\AgentPets-0.8.0.exe',
        CommandLine: '"C:\\Users\\dgh\\Desktop\\another-project\\release\\AgentPets-0.8.0.exe"',
      },
      workspace,
    ),
    null,
  )
})

const macWorkspace = '/Users/dgh/Desktop/agent-pets'

test('build preflight matches the release macOS Agent Pets.app (any arch subdirectory)', () => {
  assert.equal(
    isProjectAgentPetsProcess(
      {
        ProcessId: 111,
        CommandLine: `${macWorkspace}/release/mac-arm64/Agent Pets.app/Contents/MacOS/Agent Pets`,
      },
      macWorkspace,
    ),
    'release macOS Agent Pets.app (command line)',
  )
})

test('build preflight matches the workspace Electron development process on macOS', () => {
  assert.equal(
    isProjectAgentPetsProcess(
      {
        ProcessId: 222,
        CommandLine: `${macWorkspace}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .`,
      },
      macWorkspace,
    ),
    'workspace Electron process (macOS, command line)',
  )
})

test('build preflight does not stop an unrelated macOS Agent Pets.app in another project', () => {
  assert.equal(
    isProjectAgentPetsProcess(
      {
        ProcessId: 333,
        CommandLine: '/Users/dgh/Desktop/another-project/release/mac/Agent Pets.app/Contents/MacOS/Agent Pets',
      },
      macWorkspace,
    ),
    null,
  )
})
