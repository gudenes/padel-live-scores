import {createHash,randomBytes} from 'node:crypto'
export const newShareToken=()=>randomBytes(32).toString('base64url')
export const newShortShareToken=()=>randomBytes(16).toString('base64url')
export const validShareToken=(token:string)=>/^(?:[A-Za-z0-9_-]{22}|[A-Za-z0-9_-]{43})$/.test(token)
export const shareTokenHash=(token:string)=>createHash('sha256').update(token).digest('hex')
