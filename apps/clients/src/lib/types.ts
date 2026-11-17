export interface Project {
  id: string
  client_id: string
  title: string
  kind: string
  url: string | null
  delivered_on: string | null
  price: number | string
  currency: string
  notes: string | null
}

export interface Payment {
  id: string
  client_id: string
  project_id: string | null
  amount: number | string
  currency: string
  method: string | null
  paid_on: string
  reference: string | null
  note: string | null
  receipt_no: string
}

export interface Business {
  name: string
  contact: string
}

export const KINDS = ['app', 'panel', 'website', 'bot', 'other'] as const
export const METHODS = ['Cash', 'eSewa', 'Khalti', 'Bank transfer', 'Wise', 'PayPal', 'Crypto', 'Other'] as const
