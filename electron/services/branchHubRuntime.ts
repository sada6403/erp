import fs from 'fs'
import { BrowserWindow } from 'electron'
import { TerminalHubClient, type TerminalHubConfig } from '../branchHub/client'
import { createCompanyStore, getWorkspaceDataPath } from './companyWorkspace'
import { stopNumberedHolds } from './numberedHoldsRuntime'
import { getDb } from '../database'
import { initializeBillingOutbox, flushBillingSnapshots } from '../branchHub/billing'

let client: TerminalHubClient | undefined
let activeConfigPath = ''

/** Operator provisioned per-workspace file. Credentials never enter renderer,
 * cloud settings synchronization, logs or status responses. Restart to reconfigure. */
export function getTerminalHub(): TerminalHubClient | undefined {
  const configPath = getWorkspaceDataPath('branch-hub-terminal.json')
  if (!fs.existsSync(configPath)) return undefined
  const user = createCompanyStore().get('auth_user') as { branch_id?: string } | undefined
  if (!user?.branch_id) return undefined
  if (client && activeConfigPath !== configPath) throw new Error('Restart the application after changing company workspace')
  if (!client) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as TerminalHubConfig
    if (config.branchId !== user.branch_id) throw new Error('Hub configuration does not match the signed-in branch')
    initializeBillingOutbox(getDb(), config.branchId, config.terminalId)
    client = new TerminalHubClient(config, getWorkspaceDataPath('branch-terminal.db'), () => {
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('branchHub:changed')
    })
    activeConfigPath = configPath
    const billingClient = client
    client.setBillingSync(() => flushBillingSnapshots(getDb(), event => billingClient.sendBillingSnapshot(event)))
    client.start()
  }
  if (client.config.branchId !== user.branch_id) throw new Error('Hub client belongs to a different branch; restart and reconfigure')
  return client
}

export async function stopTerminalHub() { if (client) { await client.close(); client = undefined; activeConfigPath = '' } stopNumberedHolds() }
