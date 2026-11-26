import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import PurchaseOrdersPage from './PurchaseOrdersPage'

vi.mock('@/hooks/useBusinessType',()=>({useBusinessType:()=>({isSupermarket:true})}))
vi.mock('@/components/shared/CreatableSearchSelect',()=>({default:({items,value,onChange}:any)=><select aria-label="Supplier" value={value} onChange={e=>onChange(e.target.value)}><option value="">Select supplier</option>{items.map((item:any)=><option key={item.id} value={item.id}>{item.label}</option>)}</select>}))
const create=vi.fn()
beforeEach(()=>{
 create.mockReset().mockResolvedValue({success:true,data:{id:'new-product'}})
 window.api={
  admin:{suppliers:{list:async()=>({success:true,data:[{id:'supplier',name:'Supplier'}]})}},
  products:{list:async()=>({success:true,data:[]}),create},
  purchases:{list:async()=>({success:true,data:[]}),supplierLowStock:async()=>({success:true,data:{allSupplierProducts:[],lowStockItems:[],unassignedProducts:[]}})},
 } as any
})
afterEach(cleanup)
describe('keyboard purchase product creation',()=>{
 it('creates a supplier-linked product with F4 and selects it in the stock entry without navigation',async()=>{
  render(<PurchaseOrdersPage/>);
  fireEvent.click(screen.getByText('1. Order from Supplier'))
  await screen.findAllByRole('option',{name:'Supplier'})
  fireEvent.change(screen.getByLabelText('Supplier'),{target:{value:'supplier'}})
  const search=screen.getByLabelText('Product / barcode')
  fireEvent.change(search,{target:{value:'Loose rice'}})
  fireEvent.keyDown(search,{key:'Enter'})
  expect(await screen.findByText(/Press F4 to create it here/)).toBeInTheDocument()
  fireEvent.keyDown(window,{key:'F4'})
  fireEvent.change(screen.getByLabelText('New product barcode'),{target:{value:'0000123'}})
  fireEvent.change(screen.getByLabelText('New product unit'),{target:{value:'kg'}})
  fireEvent.change(screen.getByLabelText('New product cost_price'),{target:{value:'100'}})
  fireEvent.change(screen.getByLabelText('New product selling_price'),{target:{value:'150'}})
  fireEvent.keyDown(screen.getByLabelText('New product selling_price'),{key:'Enter'})
  await waitFor(()=>expect(create).toHaveBeenCalledWith(expect.objectContaining({name:'Loose rice',supplier_id:'supplier',barcode:'0000123',unit:'kg',cost_price:100,selling_price:150})))
  await waitFor(()=>expect(screen.getByLabelText('Product / barcode')).toHaveValue('Loose rice'))
  await waitFor(()=>expect(screen.getByLabelText('Quantity')).toHaveFocus())
  expect(screen.getByText('New Purchase Order / Quotation')).toBeInTheDocument()
 })
})
