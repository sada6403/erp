import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const { createConfiguration } = createRequire(path.resolve('package.json'))('./scripts/create-branch-hub-config.cjs')

describe('branch enrollment configuration generator', () => {
  it('creates distinct credentials and refuses to overwrite an existing deployment', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'branchhub-config-test-'))
    try {
      const output = path.join(directory, 'new-branch')
      const args = ['--branch-id', 'BR01', '--hub-url', 'http://127.0.0.1:4781', '--output', output, '--terminals', 'T01,T02']
      expect(createConfiguration(args)).toBe(output)
      const hub = JSON.parse(fs.readFileSync(path.join(output, 'hub.json'), 'utf8'))
      const first = JSON.parse(fs.readFileSync(path.join(output, 'T01', 'branch-hub-terminal.json'), 'utf8'))
      const second = JSON.parse(fs.readFileSync(path.join(output, 'T02', 'branch-hub-terminal.json'), 'utf8'))
      expect(first.token).toHaveLength(64)
      expect(first.token).not.toBe(second.token)
      expect(hub.terminals.T01).toBe(first.token)
      expect(first.branchId).toBe('BR01')
      expect(() => createConfiguration(args)).toThrow()
      expect(JSON.parse(fs.readFileSync(path.join(output, 'hub.json'), 'utf8')).terminals.T01).toBe(first.token)
    } finally {
      if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('branchhub-config-test-')) throw new Error('Unsafe test cleanup path')
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
  it('rejects duplicate terminal IDs before creating files', () => {
    expect(() => createConfiguration(['--branch-id', 'BR01', '--hub-url', 'http://localhost:4781', '--output', 'not-created', '--terminals', 'T01,T01'])).toThrow(/distinct/)
  })
})
