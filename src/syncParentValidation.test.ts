import { describe, expect, it } from 'vitest'
import { validateRequiredSyncParents } from '../backend/lib/sync'

function clientWith(rowsByTable: Record<string, Record<string, unknown>>) {
  return {
    query: async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) => {
      const table = sql.match(/FROM `([^`]+)`/)?.[1] || ''
      const id = String(values[0] || '')
      const row = rowsByTable[table]?.[id]
      return { rows: row ? [row as T] : [] }
    },
    release: () => {},
  }
}

describe('cloud sync parent validation', () => {
  it('rejects a Smart Buy scheme whose template has not reached the cloud', async () => {
    const client = clientWith({
      branches: { branch: { id: 'branch' } },
      users: { user: { id: 'user' } },
      agents: { agent: { id: 'agent' } },
      products: { product: { id: 'product' } },
    })

    await expect(validateRequiredSyncParents(client, 'chit_schemes', 'scheme', {
      id: 'scheme', template_id: 'template', branch_id: 'branch', created_by: 'user',
      agent_id: 'agent', product_id: 'product',
    }, 'INSERT')).rejects.toThrow('FOREIGN KEY (`template_id`)')
  })

  it('validates unchanged parent fields from the stored row on a partial update', async () => {
    const client = clientWith({
      chit_schemes: { scheme: { template_id: 'template', agent_id: 'missing-agent' } },
      chit_scheme_templates: { template: { id: 'template' } },
    })

    await expect(validateRequiredSyncParents(client, 'chit_schemes', 'scheme', {
      id: 'scheme', status: 'cancelled',
    }, 'UPDATE')).rejects.toThrow('FOREIGN KEY (`agent_id`)')
  })

  it('accepts a scheme after all referenced parents exist', async () => {
    const client = clientWith({
      chit_scheme_templates: { template: { id: 'template' } },
      agents: { agent: { id: 'agent' } },
      products: { product: { id: 'product' } },
      branches: { branch: { id: 'branch' } },
      users: { user: { id: 'user' } },
    })

    await expect(validateRequiredSyncParents(client, 'chit_schemes', 'scheme', {
      id: 'scheme', template_id: 'template', agent_id: 'agent', product_id: 'product',
      branch_id: 'branch', created_by: 'user',
    }, 'INSERT')).resolves.toBeUndefined()
  })
})
