import { app } from 'electron'
import Store from 'electron-store'
import path from 'path'
import fs from 'fs'
import { createHash } from 'crypto'

export const LEGACY_WORKSPACE_ID = 'legacy'

export interface CompanyWorkspaceRecord {
  id: string
  companyId: string | null
  companyKeyHash: string | null
  companyName: string
  createdAt: string
  lastUsedAt: string
}

export interface WorkspacePlan {
  workspaceId: string
  workspaceChanged: boolean
  workspaceExists: boolean
  companyId: string | null
  companyKeyHash: string
  companyName: string
}

const registry = new Store({ name: 'company-workspaces' })

function hash(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex')
}

function records(): CompanyWorkspaceRecord[] {
  const value = registry.get('workspaces')
  return Array.isArray(value) ? value as CompanyWorkspaceRecord[] : []
}

function saveRecords(value: CompanyWorkspaceRecord[]): void {
  registry.set('workspaces', value)
}

export function getActiveWorkspaceId(): string {
  return String(registry.get('active_workspace_id') || LEGACY_WORKSPACE_ID)
}

export function getWorkspaceDir(workspaceId: string): string {
  const root = app.getPath('userData')
  if (!workspaceId || workspaceId === LEGACY_WORKSPACE_ID) return root
  return path.join(root, 'company-workspaces', workspaceId)
}

export function getActiveWorkspaceDir(): string {
  return getWorkspaceDir(getActiveWorkspaceId())
}

export function getWorkspaceDataPath(...segments: string[]): string {
  return path.join(getActiveWorkspaceDir(), ...segments)
}

export function createCompanyStore<T extends Record<string, unknown> = Record<string, unknown>>(): Store<T> {
  const dir = getActiveWorkspaceDir()
  fs.mkdirSync(dir, { recursive: true })
  return new Store<T>({ cwd: dir })
}

export function createWorkspaceStore<T extends Record<string, unknown> = Record<string, unknown>>(workspaceId: string): Store<T> {
  const dir = getWorkspaceDir(workspaceId)
  fs.mkdirSync(dir, { recursive: true })
  return new Store<T>({ cwd: dir })
}

/**
 * Resolves an activation to an existing company workspace or allocates a new
 * one. Existing v2 installations remain in the legacy root directory, so the
 * first update never moves or overwrites their database.
 */
export function planCompanyWorkspace(input: {
  companyId?: string | null
  companyKey: string
  companyName?: string | null
}): WorkspacePlan {
  const activeId = getActiveWorkspaceId()
  const activeStore = createWorkspaceStore(activeId)
  const companyId = input.companyId ? String(input.companyId) : null
  const companyKeyHash = hash(input.companyKey)
  const companyName = String(input.companyName || '')
  const all = records()

  const existing = all.find(item =>
    (companyId && item.companyId === companyId) ||
    item.companyKeyHash === companyKeyHash
  )
  if (existing) {
    return { workspaceId: existing.id, workspaceChanged: existing.id !== activeId, workspaceExists: true, companyId, companyKeyHash, companyName }
  }

  const activeCompanyId = String(activeStore.get('activation_company_id') || '') || null
  const activeKey = String(activeStore.get('device_company_key') || '')
  const activeMatches = (companyId && activeCompanyId === companyId) ||
    (activeKey && hash(activeKey) === companyKeyHash)
  const activeIsUnused = !Boolean(activeStore.get('device_activated')) && activeId === LEGACY_WORKSPACE_ID

  if (activeMatches || activeIsUnused) {
    return { workspaceId: activeId, workspaceChanged: false, workspaceExists: Boolean(activeStore.get('device_activated')), companyId, companyKeyHash, companyName }
  }

  // Preserve a pre-workspace installation before allocating another tenant.
  if (!all.some(item => item.id === activeId)) {
    const oldKey = String(activeStore.get('device_company_key') || '')
    all.push({
      id: activeId,
      companyId: activeCompanyId,
      companyKeyHash: oldKey ? hash(oldKey) : null,
      companyName: String(activeStore.get('activation_company_name') || 'Existing company'),
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    })
    saveRecords(all)
  }

  const base = `company-${hash(companyId || companyKeyHash).slice(0, 16)}`
  let workspaceId = base
  let suffix = 2
  while (all.some(item => item.id === workspaceId)) workspaceId = `${base}-${suffix++}`
  return { workspaceId, workspaceChanged: workspaceId !== activeId, workspaceExists: false, companyId, companyKeyHash, companyName }
}

/** Commit only after the activation server accepts the device. */
export function activateCompanyWorkspace(plan: WorkspacePlan): void {
  const now = new Date().toISOString()
  const all = records()
  const index = all.findIndex(item => item.id === plan.workspaceId)
  const next: CompanyWorkspaceRecord = {
    id: plan.workspaceId,
    companyId: plan.companyId,
    companyKeyHash: plan.companyKeyHash,
    companyName: plan.companyName,
    createdAt: index >= 0 ? all[index].createdAt : now,
    lastUsedAt: now,
  }
  if (index >= 0) all[index] = next
  else all.push(next)
  saveRecords(all)
  registry.set('active_workspace_id', plan.workspaceId)
}

