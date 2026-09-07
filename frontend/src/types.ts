export type PageName =
  | 'login'
  | 'dashboard'
  | 'investigations'
  | 'new-investigation'
  | 'investigation-detail'
  | 'debate-room'
  | 'trust-credibility'
  | 'response-actions'
  | 'agent-fleet'
  | 'audit-trail'
  | 'settings'

export interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

export type NavigateFn = (page: PageName, investigationId?: string) => void
export type AddToastFn = (message: string, type: 'success' | 'error' | 'info') => void

export interface AgentDef {
  id: string
  monogram: string
  name: string
  color: string
  role: string
  dataSource: string
  credibility: number
  status: 'online' | 'isolated' | 'degraded'
  uptime: string
  model: string
  description: string
}

export interface Investigation {
  id: string
  verdict: 'INSIDER_THREAT' | 'EXTERNAL_ATTACK' | 'FALSE_POSITIVE' | 'INVESTIGATING'
  confidence: number
  triggerReason: string
  attackClass: string
  status: 'Investigating' | 'Verdict Reached' | 'Contained'
  rounds: number
  timestamp: string
  host: string
  ip: string
  username: string
  mitreId: string
  mitreName: string
}

export interface DebateMessage {
  agentId: string
  round: number
  claim: string
  confidence: number
  evidence: string[]
  rebuttalTo?: string
}

export interface ResponseAction {
  id: string
  timestamp: string
  investigationId: string
  action: string
  target: string
  triggeredByConfidence: number
  status: 'Executed' | 'Pending' | 'Reverted'
  reason: string
}

export interface AuditEntry {
  id: string
  timestamp: string
  actor: string
  actorType: 'agent' | 'analyst' | 'system'
  action: string
  investigationId: string
  hash: string
}
