import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest'
import { render,screen,waitFor,fireEvent,cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ManagementControlPage from '../pages/admin/ManagementControlPage'

vi.mock('@/hooks/useBusinessType',()=>({useBusinessType:()=>({isSupermarket:true})}))
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()}}))
let write:ReturnType<typeof vi.fn>
beforeEach(()=>{
 write=vi.fn().mockResolvedValue({success:true,data:{id:'saved'}})
 window.api={management:{read:vi.fn(async(resource:string)=>({success:true,data:resource==='me'?{platform:'control'}:resource==='users'?[{id:'fo',name:'Test Employee',role_code:'field_officer'}]:[]})),write,disconnect:vi.fn()}}
})
afterEach(cleanup)
describe('dynamic POS management configuration',()=>{
 it('requires explicit salary amounts instead of seeding business example defaults',async()=>{
  render(<MemoryRouter><ManagementControlPage/></MemoryRouter>)
  await screen.findByRole('button',{name:'Salary & Commission'})
  fireEvent.click(screen.getByRole('button',{name:'Salary & Commission'}))
  expect(screen.getByLabelText('Basic salary (LKR)')).toHaveValue(null)
  expect(screen.getByLabelText('Allowance per customer (LKR)')).toHaveValue(null)
  expect(screen.getByText(/No commission tiers configured/)).toBeInTheDocument()
  fireEvent.submit(screen.getByRole('button',{name:'Save policy version'}).closest('form')!)
  expect(write).not.toHaveBeenCalled()
 })
 it('sends admin-entered policy values, working days and commission tiers',async()=>{
  render(<MemoryRouter><ManagementControlPage/></MemoryRouter>)
  await screen.findByRole('button',{name:'Salary & Commission'})
  fireEvent.click(screen.getByRole('button',{name:'Salary & Commission'}))
  fireEvent.change(screen.getByLabelText('Role'),{target:{value:'field_officer'}})
  fireEvent.change(screen.getByLabelText('Employee override (optional)'),{target:{value:'fo'}})
  fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-11-01'}})
  const labels=['Basic salary (LKR)','Basic eligibility minimum (%)','Basic salary below minimum (LKR)','Target incentive (LKR)','Incentive minimum achievement (%)','Commission minimum achievement (%)','Other allowances (LKR)','Deductions (LKR)','Daily customer target','Monthly customer target','Minimum valid customers','Allowance per customer (LKR)','Maximum monthly allowance (LKR)']
  for(const name of labels)fireEvent.change(screen.getByLabelText(name),{target:{value:'0'}})
  fireEvent.change(screen.getByLabelText('Basic salary (LKR)'),{target:{value:'32100'}})
  fireEvent.click(screen.getByRole('button',{name:'Add tier'}))
  fireEvent.change(screen.getByLabelText('Achievement from (%)'),{target:{value:'60'}})
  fireEvent.change(screen.getByLabelText('Commission (%)'),{target:{value:'2.5'}})
  fireEvent.click(screen.getByLabelText('Mon'))
  fireEvent.submit(screen.getByRole('button',{name:'Save policy version'}).closest('form')!)
  await waitFor(()=>expect(write).toHaveBeenCalledWith('policy',expect.objectContaining({userId:'fo',role:'field_officer',from:'2026-11-01',policy:expect.objectContaining({basic:32100,commissionTiers:[{from:60,rate:2.5}],customer:expect.objectContaining({eligibleWeekdays:[1]})})})))
 })
})
