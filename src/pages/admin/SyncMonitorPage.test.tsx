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
 it('stops the Syncing spinner if an IPC/network request rejects',async()=>{
  mocks.trigger.mockRejectedValue(new Error('Cloud request timed out'))
  render(<SyncMonitorPage/>);await userEvent.setup().click(screen.getByRole('button',{name:/Sync Now/}))
  await waitFor(()=>expect(screen.getByRole('button',{name:/Sync Now/})).not.toBeDisabled());expect(mocks.error).toHaveBeenCalledWith('Cloud request timed out')
 })
})
