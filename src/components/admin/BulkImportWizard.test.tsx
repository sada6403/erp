import {describe,it,expect,vi,afterEach} from 'vitest'
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react'
import BulkImportWizard from './BulkImportWizard'
import {IMPORT_TYPES,DEFAULT_IMPORT_OPTIONS} from '../../../electron/lib/importRegistry'
afterEach(cleanup)
function setup(enabled=true){
 const config={enabled,admin:true,types:IMPORT_TYPES,limits:{maxBytes:10240,maxRows:100,retentionDays:30,rollbackHours:48,chunkSize:100}}
 const description={id:'job',type:'products',sheetName:'Sheet1',headerRow:0,options:{...DEFAULT_IMPORT_OPTIONS},encoding:'UTF-8',warnings:[],sheets:[{name:'Sheet1',rows:2}],headers:['SKU','Name'],preview:[['A','Tea']],suggestedMapping:{sku:0,name:1}}
 const review={id:'job',type:'products',status:'validated',total_rows:1,valid_rows:1,warning_rows:0,error_rows:0,skipped_rows:0,applied_rows:0,rows:[],sample:[],review_token:'review-1'}
 const imports={status:vi.fn(async(id?:string)=>({success:true,data:id?{...review,status:'completed',applied_rows:1}:config})),history:vi.fn().mockResolvedValue({success:true,data:[]}),templates:vi.fn().mockResolvedValue({success:true,data:[]}),upload:vi.fn().mockResolvedValue({success:true,data:description}),mapping:vi.fn().mockResolvedValue({success:true}),validate:vi.fn().mockResolvedValue({success:true,data:review}),commit:vi.fn().mockResolvedValue({success:true}),configure:vi.fn(async()=>{config.enabled=true;return {success:true}})}
 Object.defineProperty(window,'api',{configurable:true,value:{imports}});return imports
}
describe('Bulk Import v2 review flow',()=>{
 it('stays OFF until an admin explicitly enables it',async()=>{
  const api=setup(false);render(<BulkImportWizard onClose={()=>{}}/>)
  await screen.findByText(/Bulk Import v2 is OFF/);expect(api.configure).not.toHaveBeenCalled();expect(screen.queryByText('Choose XLSX / XLS / CSV / TSV')).toBeNull()
  fireEvent.click(screen.getByText('Admin settings'));fireEvent.click(screen.getByText('Save settings and enable'))
  await waitFor(()=>expect(api.configure).toHaveBeenCalledWith(expect.objectContaining({enabled:true})))
 })
 it('requires all required fields to be mapped and warns on duplicate field assignment',async()=>{
  setup();render(<BulkImportWizard onClose={()=>{}}/>);const upload=await screen.findByText('Choose XLSX / XLS / CSV / TSV');await waitFor(()=>expect(upload).not.toBeDisabled());fireEvent.click(upload)
  await screen.findByLabelText('Map column 2')
  fireEvent.change(screen.getByLabelText('Map column 2'),{target:{value:''}})
  expect(screen.getByText('4. Dry run validation')).toBeDisabled();expect(screen.getByText(/Map required field: Product name/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Map column 2'),{target:{value:'sku'}})
  expect(screen.getByText('This system field is already mapped to another file column')).toBeInTheDocument()
 })
 it('requires explicit preview review and sends the validation token on commit',async()=>{
  const api=setup();render(<BulkImportWizard onClose={()=>{}}/>);const upload=await screen.findByText('Choose XLSX / XLS / CSV / TSV');await waitFor(()=>expect(upload).not.toBeDisabled());fireEvent.click(upload)
  await screen.findByLabelText('Map column 2');fireEvent.click(screen.getByText('4. Dry run validation'))
  const commit=await screen.findByText('5. Commit import');expect(commit).toBeDisabled()
  fireEvent.click(screen.getByLabelText(/I reviewed the normalized preview/));fireEvent.click(commit)
  await waitFor(()=>expect(api.commit).toHaveBeenCalledWith('job','review-1',undefined))
 })
})
