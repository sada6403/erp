import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import ProductSearchSelect from './ProductSearchSelect'

afterEach(cleanup)
describe('purchase product search',()=>{
 it.each(['Rice','SKU-1','00012345'])('selects by name, SKU or barcode: %s',query=>{
  const onChange=vi.fn()
  render(<ProductSearchSelect products={[{id:'rice',name:'Rice',sku:'SKU-1',barcode:'00012345'},{id:'flour',name:'Flour',sku:'SKU-2',barcode:'000999'}]} value="" onChange={onChange}/>)
  fireEvent.click(screen.getByText('Select product...'))
  const input=screen.getByPlaceholderText('Search name, barcode or SKU...')
  fireEvent.change(input,{target:{value:query}})
  expect(screen.queryByText('Flour')).not.toBeInTheDocument()
  fireEvent.keyDown(input,{key:'Enter'})
  expect(onChange).toHaveBeenCalledWith('rice')
 })
})
