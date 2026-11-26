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
describe('inline purchase product creation',()=>{
 it('creates a supplier-linked product and adds it to the current purchase without navigation',async()=>{
  render(<PurchaseOrdersPage/>);
  fireEvent.click(screen.getByText('1. Order from Supplier'))
  await screen.findAllByRole('option',{name:'Supplier'})
  fireEvent.change(screen.getByLabelText('Supplier'),{target:{value:'supplier'}})
  fireEvent.click(screen.getByRole('button',{name:'New product'}))
  fireEvent.change(screen.getByLabelText('Product name'),{target:{value:'Loose rice'}})
  fireEvent.change(screen.getByLabelText('Barcode'),{target:{value:'0000123'}})
  fireEvent.change(screen.getByLabelText('Base unit'),{target:{value:'kg'}})
  fireEvent.change(screen.getByLabelText('Purchase price'),{target:{value:'100'}})
  fireEvent.change(screen.getByLabelText('Selling price'),{target:{value:'150'}})
  fireEvent.click(screen.getByRole('button',{name:'Create and add'}))
  await waitFor(()=>expect(create).toHaveBeenCalledWith(expect.objectContaining({name:'Loose rice',supplier_id:'supplier',barcode:'0000123',unit:'kg',cost_price:100,selling_price:150})))
  await waitFor(()=>expect(screen.queryByText('Create product for this supplier')).not.toBeInTheDocument())
  expect(screen.getByText(/Loose rice \(/)).toBeInTheDocument()
  expect(screen.getByText('New Purchase Order / Quotation')).toBeInTheDocument()
 })
})
