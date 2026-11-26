import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

export default function PosTestingTools(){
  const [status,setStatus]=useState({enabled:false,can_configure:false,can_clear:false})
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[restart,setRestart]=useState(false)
  const dialog=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null)
  useEffect(()=>{window.api.testing?.status().then((result:any)=>{if(result.success)setStatus(result.data)}).catch(()=>undefined)},[])
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(!status.enabled&&!status.can_configure)return
      if(event.altKey&&event.key.toLowerCase()==='t'){
        event.preventDefault();event.stopImmediatePropagation();if(!busy&&!restart)setOpen(value=>!value);return
      }
      if(!open)return
      // Capture only keyboard events: parent POS shortcuts must sleep under this dialog.
      event.stopPropagation()
      if(event.key==='Escape'&&!busy&&!restart){event.preventDefault();setOpen(false);button.current?.focus()}
      if(event.key==='Tab'){
        const fields=Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[])
        const first=fields[0],last=fields[fields.length-1]
        if((event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last)){
          event.preventDefault();(event.shiftKey?last:first)?.focus()
        }
      }
    }
    // Window capture blocks parent window shortcut listeners, preserving native button actions.
    window.addEventListener('keydown',handler,true)
    return()=>window.removeEventListener('keydown',handler,true)
  },[open,busy,restart,status.enabled,status.can_configure])
  useEffect(()=>{if(open)dialog.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()},[open,restart])
  const change=async(action:'enable'|'reset'|'disable'|'clear_existing')=>{
    if(busy||restart)return
    setBusy(true)
    try{const result=await window.api.testing.change(action);if(!result.success)throw new Error(result.error);setRestart(true)}
    catch(err){toast.error((err as Error).message)}finally{setBusy(false)}
  }
  if(!status.enabled&&!status.can_configure)return null
  return <>
    <button ref={button} type="button" className={`btn-secondary btn-sm ${status.enabled?'text-yellow-400':''}`} onClick={()=>setOpen(true)} title="Testing tools (Alt+T)">
      {status.enabled?'TEST MODE · Clear Test Transactions':'Testing Mode'} <kbd>Alt+T</kbd>
    </button>
    {open&&<div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4">
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="POS Testing Mode" className="card w-full max-w-lg space-y-4">
        <h2 className="font-semibold text-lg">POS Testing Mode</h2>
        <p className="text-sm">{status.enabled?'Test bills use a separate local database. Cloud, branch server and customer messages are disabled.':'Admin can start a separate test copy of this terminal. Live bills and stock stay in the live database.'}</p>
        <p className="text-sm">Clear Test Transactions restores the test copy to its starting snapshot, including stock and balances. Transactions that existed before testing stay in that snapshot. Restart and sign in again after changing mode or clearing tests.</p>
        {restart?<button className="btn-primary w-full" onClick={()=>void window.api.testing.restart()}>Restart POS now</button>:<div className="flex flex-wrap gap-2">
          {status.can_configure&&!status.enabled&&<button disabled={busy} className="btn-primary" onClick={()=>void change('enable')}>Enable Testing Mode & prepare restart</button>}
          {status.enabled&&status.can_clear&&<button disabled={busy} className="btn-primary" onClick={()=>void change('reset')}>Clear Test Transactions & prepare restart</button>}
          {status.enabled&&status.can_configure&&<button disabled={busy} className="btn-secondary" onClick={()=>void change('clear_existing')}>Start test copy without old sales history</button>}
          {status.enabled&&status.can_configure&&<button disabled={busy} className="btn-secondary" onClick={()=>void change('disable')}>Disable Testing Mode & prepare restart</button>}
          <button disabled={busy} className="btn-secondary" onClick={()=>{setOpen(false);button.current?.focus()}}>Close · Esc</button>
        </div>}
      </div>
    </div>}
  </>
}
