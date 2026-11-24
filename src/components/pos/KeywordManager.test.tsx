import {describe,it,expect,vi,afterEach} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import KeywordManager from './KeywordManager'
afterEach(cleanup)
function api(admin=false){const keywords={status:vi.fn().mockResolvedValue({success:true,data:{enabled:true,uniqueCodes:true,admin,manage:admin,own:true}}),list:vi.fn().mockResolvedValue({success:true,data:[]}),save:vi.fn().mockResolvedValue({success:true}),configure:vi.fn().mockResolvedValue({success:true}),review:vi.fn().mockResolvedValue({success:true})};Object.defineProperty(window,'api',{configurable:true,value:{keywords}});return keywords}
describe('keyword management permissions and review',()=>{
  it('offers only personal scope to a cashier and sends the master identity',async()=>{
    const keywords=api();render(<KeywordManager product={{id:'rice',name:'Rice'}} onClose={()=>{}}/>)
    await screen.findByLabelText('Keyword')
    expect(screen.getByLabelText('Keyword scope').querySelectorAll('option')).toHaveLength(1)
    expect(screen.queryByText(/Enable keywords/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Keyword'),{target:{value:'அரிசி'}})
    fireEvent.click(screen.getByText('Save keyword'))
    await waitFor(()=>expect(keywords.save).toHaveBeenCalledWith(expect.objectContaining({product_id:'rice',keyword:'அரிசி',scope_type:'user'})))
  })
  it('lets an admin select and approve automatic drafts without changing master names',async()=>{
    const keywords=api(true);keywords.list.mockResolvedValue({success:true,data:[{id:'draft',product_id:'rice',product_name:'Rice',keyword:'arisi',scope_type:'global',source:'auto_translit',review_status:'pending',is_active:0}] as any})
    render(<KeywordManager onClose={()=>{}}/>);await screen.findByText('arisi')
    expect(screen.getByText('Rice')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Select arisi'));fireEvent.click(screen.getByText('Approve selected drafts'))
    await waitFor(()=>expect(keywords.review).toHaveBeenCalledWith(['draft'],'approved'))
  })
})
