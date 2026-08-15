import { useState } from 'react'
import toast from 'react-hot-toast'

interface DeleteResult { success: boolean; error?: string }

// Shared "select record → confirm → delete → refresh" state machine used by
// every list page's Delete action. Centralizes exactly the parts that must
// stay consistent across entities (busy-state so a double-click can't fire
// two deletes, standardized success/error toast copy, closing the
// confirmation dialog only after a real success) while leaving the actual
// delete call — and its permission/dependency/business-rule validation — to
// each entity's own existing IPC handler.
export function useDeleteAction<T extends { id: string }>(
  deleteFn: (id: string) => Promise<DeleteResult>,
  onDeleted: () => void,
) {
  const [target, setTarget] = useState<T | null>(null)
  const [busy, setBusy] = useState(false)

  const requestDelete = (item: T) => {
    if (!busy) setTarget(item)
  }
  const cancel = () => {
    if (!busy) setTarget(null)
  }

  const confirm = async () => {
    if (!target || busy) return
    setBusy(true)
    try {
      const res = await deleteFn(target.id)
      if (res.success) {
        toast.success('Record deleted successfully.')
        setTarget(null)
        onDeleted()
      } else {
        toast.error(res.error || 'Record was not synchronized with the cloud. Please try again.')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Cloud connection failed. The deletion will be synchronized when the connection is restored.')
    } finally {
      setBusy(false)
    }
  }

  return { target, busy, requestDelete, cancel, confirm }
}
