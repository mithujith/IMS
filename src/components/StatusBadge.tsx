export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  let cls = 'text-slate-600 bg-slate-100';
  if (
    ['active', 'confirmed', 'delivered', 'paid', 'received', 'adjusted', 'transferred', 'invoiced'].includes(
      normalized
    )
  ) {
    cls = 'text-emerald-700 bg-emerald-50';
  } else if (
    ['issued', 'sent', 'packed', 'shipped', 'partially_paid', 'partially_received', 'in_progress', 'in_transit', 'open'].includes(
      normalized
    )
  ) {
    cls = 'text-blue-700 bg-blue-50';
  } else if (['overdue', 'void', 'cancelled', 'inactive', 'revoked'].includes(normalized)) {
    cls = 'text-red-700 bg-red-50';
  } else if (['draft', 'pending', 'not_shipped'].includes(normalized)) {
    cls = 'text-amber-700 bg-amber-50';
  }

  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium capitalize ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
