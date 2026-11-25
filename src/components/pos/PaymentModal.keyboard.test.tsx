import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {MemoryRouter} from 'react-router-dom'
import PaymentModal from './PaymentModal'
import {useCartStore} from '@/store/cartStore'
import type {Product} from '@/types'
vi.mock('@/store/authStore',()=>({useAuthStore:()=>({user:{id:'cashier',name:'Cashier',branch:{id:'main'}}})}))
vi.mock('react-hot-toast',()=>({default:{error:vi.fn(),success:vi.fn()}}))
let create:ReturnType<typeof vi.fn>,close:ReturnType<typeof vi.fn>,success:ReturnType<typeof vi.fn>
beforeEach(()=>{
 useCartStore.getState().clear()
 useCartStore.getState().addItem({id:'product',sku:'P',name:'Product',unit:'pcs',selling_price:2325,tax_rate:0,stock:10,is_active:true} as Product,1)
 create=vi.fn().mockResolvedValue({success:false,error:'Test response'});close=vi.fn();success=vi.fn()
 Object.defineProperty(window,'api',{configurable:true,value:{
  settings:{get:vi.fn().mockResolvedValue({success:true,data:{branch_id:'main'}})},
  agents:{list:vi.fn().mockResolvedValue({success:true,data:[{id:'a',code:'AG1',name:'First agent'},{id:'b',code:'AG2',name:'Second agent'}]})},
  invoices:{create},admin:{installments:{plans:vi.fn().mockResolvedValue({success:true,data:[]})}},customers:{list:vi.fn().mockResolvedValue({success:true,data:[]})},
 }})
})
afterEach(()=>{cleanup();useCartStore.getState().clear()})
function show(keyboardActive=true){return render(<MemoryRouter><PaymentModal invoiceNumber="INV-TEST" billType="RETAIL" onClose={close} onSuccess={success} keyboardActive={keyboardActive}/></MemoryRouter>)}
describe('payment keyboard checkout',()=>{
 it('opens at the selected amount and contains Tab/Shift+Tab within the dialog',async()=>{
  show();const user=userEvent.setup();const amount=screen.getByRole('textbox',{name:'Amount received'})
  expect(amount).toHaveFocus();expect(amount).toHaveValue('2325')
  const first=screen.getByRole('button',{name:'Close payment'});first.focus();await user.tab({shift:true})
  expect(screen.getByRole('button',{name:/Confirm Payment/})).toHaveFocus();await user.tab();expect(first).toHaveFocus()
 })
 it('switches every allowed method with Ctrl and focuses its entry field from agent search',async()=>{
  show();const user=userEvent.setup();screen.getByRole('combobox',{name:'Agent'}).focus()
  await user.keyboard('{Control>}2{/Control}');expect(screen.getByRole('button',{name:'Card'})).toHaveAttribute('aria-pressed','true');expect(screen.getByRole('textbox',{name:'Amount received'})).toHaveFocus()
  await user.keyboard('{Control>}3{/Control}');expect(screen.getByRole('button',{name:'Bank'})).toHaveAttribute('aria-pressed','true')
  await user.keyboard('{Control>}4{/Control}');expect(screen.getByRole('combobox',{name:'Installment customer'})).toHaveFocus()
  await user.keyboard('{Control>}1{/Control}');expect(screen.getByRole('textbox',{name:'Amount received'})).toHaveFocus();expect(create).not.toHaveBeenCalled()
 })
 it('selects an agent with arrows and Enter without submitting payment',async()=>{
  show();const user=userEvent.setup();const agent=screen.getByRole('combobox',{name:'Agent'})
  await user.type(agent,'AG');await screen.findByRole('option',{name:/Second agent/});await user.keyboard('{ArrowDown}{Enter}')
  expect((agent as HTMLInputElement).value).toContain('AG2');expect(screen.getByRole('textbox',{name:'Amount received'})).toHaveFocus();expect(create).not.toHaveBeenCalled()
 })
 it('activates payment method and Cancel buttons with their native Enter actions',async()=>{
  show();const user=userEvent.setup();screen.getByRole('button',{name:'Cash'}).focus();await user.keyboard('{ArrowRight}{Enter}')
  expect(screen.getByRole('button',{name:'Card'})).toHaveAttribute('aria-pressed','true');expect(create).not.toHaveBeenCalled()
  screen.getByRole('button',{name:/Cancel/}).focus();await user.keyboard('{Enter}');expect(close).toHaveBeenCalledTimes(1);expect(create).not.toHaveBeenCalled()
 })
 it('Escape closes suggestions first, then closes the payment dialog',async()=>{
  show();const user=userEvent.setup();await user.type(screen.getByRole('combobox',{name:'Agent'}),'AG');await screen.findByRole('option',{name:/First agent/})
  await user.keyboard('{Escape}');expect(screen.queryByRole('listbox')).not.toBeInTheDocument();expect(close).not.toHaveBeenCalled()
  await user.keyboard('{Escape}');expect(close).toHaveBeenCalledTimes(1)
 })
 it('submits once on amount Enter and ignores key repeat and duplicate events while processing',async()=>{
  let resolve:(value:unknown)=>void=()=>{};create.mockImplementation(()=>new Promise(r=>{resolve=r}));show()
  const amount=screen.getByRole('textbox',{name:'Amount received'});fireEvent.keyDown(amount,{key:'Enter',repeat:true});expect(create).not.toHaveBeenCalled()
  fireEvent.keyDown(amount,{key:'Enter'});fireEvent.keyDown(amount,{key:'Enter'});await waitFor(()=>expect(create).toHaveBeenCalledTimes(1))
  fireEvent.keyDown(amount,{key:'Escape'});expect(close).not.toHaveBeenCalled();resolve({success:false,error:'Test response'});await waitFor(()=>expect(screen.getByRole('button',{name:/Confirm Payment/})).not.toBeDisabled())
 })
 it('restores focus to the caller after the modal unmounts',()=>{
  render(<button>Pay from POS</button>);const caller=screen.getByRole('button',{name:'Pay from POS'});caller.focus();const modal=show();modal.unmount();expect(caller).toHaveFocus()
 })
 it('opens the customer picker with F2 and suspends parent shortcuts under child dialogs',async()=>{
  const opened=vi.fn();window.addEventListener('pos:open-customer',opened)
  const modal=show();fireEvent.keyDown(screen.getByRole('textbox',{name:'Amount received'}),{key:'F2'});expect(opened).toHaveBeenCalledTimes(1)
  modal.unmount();close.mockClear();show(false);fireEvent.keyDown(window,{key:'Escape'});fireEvent.keyDown(window,{key:'2',ctrlKey:true});expect(close).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Cash'})).toHaveAttribute('aria-pressed','true')
  window.removeEventListener('pos:open-customer',opened)
 })
 it('focuses New Invoice after payment and activates it once with Enter',async()=>{
  create.mockResolvedValue({success:true,data:{id:'invoice',invoice_number:'INV-SAVED'}});show();const user=userEvent.setup();await user.keyboard('{Enter}')
  const next=await screen.findByRole('button',{name:/New Invoice/});expect(next).toHaveFocus();await user.keyboard('{Enter}');expect(success).toHaveBeenCalledTimes(1);expect(create).toHaveBeenCalledTimes(1)
 })

})
