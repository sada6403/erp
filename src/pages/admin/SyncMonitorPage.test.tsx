import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {render,screen,waitFor,cleanup} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SyncMonitorPage from './SyncMonitorPage'
const mocks=vi.hoisted(()=>({trigger:vi.fn(),refresh:vi.fn(),error:vi.fn()}))
vi.mock('@/hooks/useSyncStatus',()=>({useSyncStatus:()=>({status:{online:true,pending:0,failed:0,quarantined:0,running:false,lastSync:null},triggerSync:mocks.trigger,refresh:mocks.refresh})}))
vi.mock('@/store/authStore',()=>({useAuthStore:()=>({user:{permissions:{all:true}}})}))
vi.mock('react-hot-toast',()=>({default:{error:mocks.error,success:vi.fn()}}))
beforeEach(()=>{mocks.trigger.mockReset();mocks.refresh.mockResolvedValue(undefined);mocks.error.mockClear();Object.defineProperty(window,'api',{configurable:true,value:{sync:{queue:vi.fn().mockResolvedValue({success:true,data:[]}),quarantine:vi.fn().mockResolvedValue({success:true,data:[]})}}})})
afterEach(cleanup)
describe('sync monitor request recovery',()=>{
 it('shows branch delivery state and saves a changed server address',async()=>{
  window.api.holds={hubStatus:vi.fn().mockResolvedValue({success:true,data:{configured:true,terminal_id:'T01',server_url:'http://OLD:4781',hub_online:true,billing_pending:2,postgres:{configured:true,connected:false,pending:3}}}),updateHubUrl:vi.fn().mockResolvedValue({success:true})} as any
  render(<SyncMonitorPage/>);const field=await screen.findByRole('textbox',{name:'Branch server address'});const user=userEvent.setup()
  await user.clear(field);await user.type(field,'http://NEW:4781');await user.click(screen.getByRole('button',{name:'Save address'}))
  await waitFor(()=>expect(window.api.holds.updateHubUrl).toHaveBeenCalledWith('http://NEW:4781'))
  expect(screen.getByText(/Bills awaiting Hub: 2/)).toHaveTextContent('Awaiting PostgreSQL: 3')
 })
 it('stops the Syncing spinner if an IPC/network request rejects',async()=>{
  mocks.trigger.mockRejectedValue(new Error('Cloud request timed out'))
  render(<SyncMonitorPage/>);await userEvent.setup().click(screen.getByRole('button',{name:/Sync Now/}))
  await waitFor(()=>expect(screen.getByRole('button',{name:/Sync Now/})).not.toBeDisabled());expect(mocks.error).toHaveBeenCalledWith('Cloud request timed out')
 })
})
