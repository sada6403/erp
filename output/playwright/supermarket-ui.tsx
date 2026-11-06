import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Dashboard from '/src/pages/admin/AdminDashboard'
import Purchases from '/src/pages/admin/PurchaseOrdersPage'
import Batches from '/src/pages/admin/BatchesPage'
import AppLayout from '/src/components/layout/AppLayout'
import { useAuthStore } from '/src/store/authStore'
import '/src/index.css'
let business_type = 'supermarket'
const listeners = new Set<() => void>()
const empty = new Proxy(async () => ({ success: true, data: [] }), { get: () => empty })
window.api = new Proxy({}, { get: (_, key) => {
  if (key === 'on') return (event: string, fn: () => void) => { if(event === 'settings:updated') listeners.add(fn); return () => listeners.delete(fn) }
  if (key === 'settings') return { get: async () => ({ success: true, data: { business_type, company_name: 'Supermarket UI verification' } }), refreshBranding: async () => ({success: true}) }
  if (key === 'analytics') return new Proxy({}, { get: (_, name) => name === 'supermarketOverview' ? async () => ({ success: true, data: { stock_cost: 1600, expected_sales: 2000, expected_profit: 400, actual_profit: 600, investment: 10000 } }) : empty })
  if (key === 'investments') return { list: async () => ({success: true, data: {rows: [], totals: {}}}) }
  return empty
} })
useAuthStore.setState({ user: { id: 'ui-test', name: 'UI Test Owner', business_type, role: { permissions: {all: true} }, branch_id: 'ui-branch' } as any, isLoading: false })
;(window as any).setTestBusinessType = (type: string) => { business_type=type; listeners.forEach(fn=>fn()) }
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/admin']}><Routes><Route element={<AppLayout />}><Route path="/admin" element={<Dashboard />} /><Route path="/admin/purchase-orders" element={<Purchases />} /><Route path="/admin/batches" element={<Batches />} /></Route></Routes></MemoryRouter>)
