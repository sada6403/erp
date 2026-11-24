import fs from 'fs'
import { LocalNumberedHolds } from '../branchHub/localHolds'
import { getWorkspaceDataPath } from './companyWorkspace'

const stores = new Map<string, LocalNumberedHolds>()
export function localNumberedHolds(create = false) {
  const filename = getWorkspaceDataPath('numbered-held-carts.db')
  if (!stores.has(filename) && (create || fs.existsSync(filename))) stores.set(filename, new LocalNumberedHolds(filename))
  return stores.get(filename)
}
export function stopNumberedHolds() { for (const store of stores.values()) store.close(); stores.clear() }
