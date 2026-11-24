import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {describe,it,expect,vi,afterEach} from 'vitest'
import {useBatchGuard} from './useBatchGuard'
afterEach(cleanup)
function Harness({done}:{done:(value:unknown)=>void}){const guard=useBatchGuard();return <><button onClick={()=>void guard.confirm([{product_id:'p',batch_number:'B1'}]).then(done)}>Save batch</button>{guard.dialog}</>}
describe('duplicate-batch choice',()=>{
 it('shows existing stock/date, cancels without saving, and adds only after explicit selection',async()=>{
  Object.defineProperty(window,'api',{configurable:true,value:{batches:{inspect:vi.fn().mockResolvedValue({success:true,data:{existing:{id:'key',quantity:7,entered_at:'2026-11-01',batch_number:'B1',mfg_date:'2026-10-01',expiry_date:'2027-10-01'},warnings:[]}})}}})
  const done=vi.fn();render(<Harness done={done}/>);fireEvent.click(screen.getByText('Save batch'))
  await screen.findByText(/Stock quantity: 7/);expect(screen.getByText(/Entered date: 2026-11-01/)).toBeInTheDocument();fireEvent.click(screen.getByText('Cancel'));await waitFor(()=>expect(done).toHaveBeenCalledWith(null))
  fireEvent.click(screen.getByText('Save batch'));await screen.findByText(/Stock quantity: 7/);fireEvent.click(screen.getByText('Existing batch-ku quantity add pannu'));await waitFor(()=>expect(done).toHaveBeenLastCalledWith([expect.objectContaining({batch_resolution:'add_existing',existing_batch_id:'key',mfg_date:'2026-10-01'})]))
 })
})
