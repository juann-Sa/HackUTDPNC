// Demo-only browser session. Passwords are never stored, sent, or logged.
export interface DemoSession { email:string;name?:string;customerId:string }
const USER_KEY='pnc-navigator-user-v1';
const CUSTOMER_KEY='pnc-navigator-customer-v1';
export const DEFAULT_CUSTOMER='C006';
export function startSession(session:DemoSession):void{
 try{localStorage.setItem(USER_KEY,JSON.stringify({email:session.email,name:session.name}));localStorage.setItem(CUSTOMER_KEY,session.customerId);}catch{/* Browser storage unavailable. */}
}
export function getSession():{email:string;name?:string}|null{
 try{const raw=localStorage.getItem(USER_KEY);const value:unknown=raw?JSON.parse(raw):null;if(!value||typeof value!=='object'||!('email' in value)||typeof value.email!=='string')return null;return {email:value.email,name:'name' in value&&typeof value.name==='string'?value.name:undefined};}catch{return null;}
}
export function endSession():void{try{localStorage.removeItem(USER_KEY);}catch{/* Nothing to clear. */}}
