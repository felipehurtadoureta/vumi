import clsx from 'clsx'
import type { CaseStatus } from '@/lib/types'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/types'

interface Props {
  status: CaseStatus
  size?: 'sm' | 'md'
  label?: string   // override del texto mostrado
  color?: string   // override del color
}

export default function StatusBadge({ status, size = 'md', label, color }: Props) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full font-medium',
        color ?? STATUS_COLORS[status],
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs'
      )}
    >
      {label ?? STATUS_LABELS[status]}
    </span>
  )
}
