import {forwardRef,useState,type InputHTMLAttributes} from 'react'
import {Eye,EyeOff} from 'lucide-react'
const PasswordInput=forwardRef<HTMLInputElement,InputHTMLAttributes<HTMLInputElement>>(function PasswordInput({className='input',autoComplete='new-password',...props},ref){
 const [visible,setVisible]=useState(false)
 return <div className="relative"><input {...props} ref={ref} type={visible?'text':'password'} autoComplete={autoComplete} className={className+' pr-10'}/><button type="button" className="absolute right-3 top-1/2 -translate-y-1/2" aria-label={visible?'Hide password':'Show password'} aria-pressed={visible} onClick={()=>setVisible(value=>!value)}>{visible?<EyeOff size={16}/>:<Eye size={16}/>}</button></div>
})
export default PasswordInput
