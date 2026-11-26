import React from 'react'
import {createRoot} from 'react-dom/client'
import {Toaster} from 'react-hot-toast'
import PurchaseOrdersPage from '../../src/pages/admin/PurchaseOrdersPage'
import {useAuthStore} from '../../src/store/authStore'
import '../../src/index.css'

window.api.auth.whoami().then((response:any)=>{
 useAuthStore.setState({user:response.data,isLoading:false})
 createRoot(document.getElementById('root')!).render(<React.StrictMode><div style={{height:'100vh',background:'var(--bg-page)',color:'var(--text-1)'}}><div className="px-5 py-2 text-xs" style={{background:'var(--bg-soft)'}}>ISOLATED QA DATABASE · Production connections disabled</div><PurchaseOrdersPage/></div><Toaster/></React.StrictMode>)
})
