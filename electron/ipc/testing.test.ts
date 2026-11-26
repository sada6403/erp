import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
const state=vi.hoisted(()=>({user:{id:'cashier',permissions:{}} as any,prepare:vi.fn(),reset:vi.fn(),disable:vi.fn()}))
vi.mock('electron',()=>({app:{getPath:()=>'/unused',relaunch:vi.fn(),quit:vi.fn()}}))
vi.mock('../database',()=>({getDb:()=>({})}))
vi.mock('../services/companyWorkspace',()=>({createCompanyStore:()=>({get:()=>state.user,store:{}}),getActiveWorkspaceId:()=> 'legacy'}))
vi.mock('../services/testingSandbox',()=>({prepareTestSession:state.prepare,resetTestSession:state.reset,disableTestSession:state.disable}))
import {registerTestingHandlers} from './testing'
const handlers=new Map<string,Function>(),original=process.env.POS_TEST_MODE
beforeEach(()=>{delete process.env.POS_TEST_MODE;state.user={id:'cashier',permissions:{}};vi.clearAllMocks();registerTestingHandlers({handle:(name:string,fn:Function)=>handlers.set(name,fn)} as any)})
afterEach(()=>{if(original===undefined)delete process.env.POS_TEST_MODE;else process.env.POS_TEST_MODE=original})
const change=(action:string)=>handlers.get('testing:change')!({},action)
describe('testing mode authorization',()=>{
  it('blocks clearing live transaction history even for Admin',async()=>{
    state.user.permissions.all=true;expect((await change('reset')).success).toBe(false);expect(state.reset).not.toHaveBeenCalled()
  })
  it('lets a signed-in cashier clear the isolated test copy only',async()=>{
    process.env.POS_TEST_MODE='1';expect((await change('reset')).success).toBe(true);expect(state.reset).toHaveBeenCalledOnce()
    expect((await change('disable')).success).toBe(false);expect((await change('enable')).success).toBe(false)
  })
  it('requires Admin for enabling and disabling, and authentication for reset',async()=>{
    expect((await change('enable')).success).toBe(false)
    state.user.permissions.all=true;expect((await change('enable')).success).toBe(true);expect(state.prepare).toHaveBeenCalledOnce()
    process.env.POS_TEST_MODE='1';expect((await change('disable')).success).toBe(true)
    state.user=undefined;expect((await change('reset')).success).toBe(false)
  })
})
