import { jsonValue,type ManagementContext } from './access'

/** Explicit per-invoice attribution wins. Automatic mode is centrally configured, never inferred. */
export async function attributionExpression(ctx:ManagementContext){
 const {rows}=await ctx.client.query<{value:unknown}>("SELECT value FROM management_settings WHERE id='sales-credit'")
 const mode=rows.length?jsonValue<{mode?:string}>(rows[0].value).mode:null
 if(mode==='agent-link')return 'COALESCE(a.user_id,ag.user_id)'
 if(mode==='cashier')return 'COALESCE(a.user_id,i.cashier_id)'
 return 'a.user_id'
}
export async function attributionJoins(ctx:ManagementContext){
 const {rows}=await ctx.client.query<{value:unknown}>("SELECT value FROM management_settings WHERE id='sales-credit'")
 const mode=rows.length?jsonValue<{mode?:string}>(rows[0].value).mode:null
 if(mode==='agent-link')return 'LEFT JOIN management_attributions a ON a.invoice_id=i.id LEFT JOIN agents ag ON (ag.id=i.agent_id OR ag.code=i.agent_code)'
 return 'LEFT JOIN management_attributions a ON a.invoice_id=i.id'
}
