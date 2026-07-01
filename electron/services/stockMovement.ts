import type Database from 'better-sqlite3'
import crypto from 'crypto'

export type StockMovementType = 'SALE' | 'TRANSFER' | 'ADJUSTMENT' | 'RECEIVE'

export type StockMovementInput = {
  product_id: string
  from_branch_id?: string | null
  to_branch_id?: string | null
  quantity: number
  movement_type: StockMovementType
  reference_order_id?: string | null
  reference_transfer_id?: string | null
  notes?: string | null
  created_by?: string | null
}

export function insertStockMovement(
  db: Database.Database,
  input: StockMovementInput
): Record<string, unknown> {
  const record = {
    id: crypto.randomUUID(),
    product_id: input.product_id,
    from_branch_id: input.from_branch_id || null,
    to_branch_id: input.to_branch_id || null,
    quantity: Math.max(0, Math.trunc(Number(input.quantity) || 0)),
    movement_type: input.movement_type,
    reference_order_id: input.reference_order_id || null,
    reference_transfer_id: input.reference_transfer_id || null,
    notes: input.notes || null,
    created_by: input.created_by || null,
  }

  if (record.quantity <= 0) {
    throw new Error('Stock movement quantity must be greater than zero')
  }

  db.prepare(`
    INSERT INTO stock_movements (
      id, product_id, from_branch_id, to_branch_id, quantity, movement_type,
      reference_order_id, reference_transfer_id, notes, created_by
    )
    VALUES (
      @id, @product_id, @from_branch_id, @to_branch_id, @quantity, @movement_type,
      @reference_order_id, @reference_transfer_id, @notes, @created_by
    )
  `).run(record)

  return record
}
