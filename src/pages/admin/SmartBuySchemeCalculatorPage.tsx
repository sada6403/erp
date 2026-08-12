import PageHeader from '@/components/shared/PageHeader'
import SmartBuyViabilityCalculator from '@/components/shared/SmartBuyViabilityCalculator'

// Standalone entry point for the SmartBuy Scheme Viability Calculator (§13)
// — the same reusable component embedded in the New Scheme flow
// (ChitSchemesPage.tsx), for ad-hoc "what if" exploration outside of
// actually creating a scheme (no onUseValues here, so no create-scheme
// button is shown — this page never creates anything).
export default function SmartBuySchemeCalculatorPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="SmartBuy Scheme Viability Calculator"
        subtitle="Simulate a scheme's real cycle-by-cycle economics before starting it — profitability, break-even members, and cash-flow risk."
      />
      <div className="flex-1 overflow-auto p-6 max-w-4xl">
        <SmartBuyViabilityCalculator />
      </div>
    </div>
  )
}
