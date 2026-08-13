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
