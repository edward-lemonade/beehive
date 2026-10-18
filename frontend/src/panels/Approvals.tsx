import type { MineEntry } from '../api/schemas'
import { itemText, money } from '../lib/format'

export function CommittedDeal({ entry }: { entry: MineEntry }) {
  const t = entry.terms
  const contacts = entry.contacts ?? []
  return (
    <div className="w-full max-w-[95%] rounded border border-slate-200 bg-white p-3 text-sm" data-testid="committed-deal">
      <ul className="space-y-0.5">
        {t.gives.map((g, i) => <li key={`g${i}`}>Give {itemText(g.item)} to {g.toHandle}</li>)}
        {t.gets.map((g, i) => <li key={`r${i}`}>Get {itemText(g.item)} from {g.fromHandle}</li>)}
        {t.cashOut.map((c, i) => <li key={`o${i}`}>Pay {money(c.amountCents)} to {c.toHandle}</li>)}
        {t.cashIn.map((c, i) => <li key={`i${i}`}>Receive {money(c.amountCents)} from {c.fromHandle}</li>)}
      </ul>
      <p className="mt-2 text-xs text-slate-600">
        {contacts.length === 0
          ? 'Contact details are not available yet.'
          : `Arrange the rest directly: ${contacts.map((c) => `${c.handle} ${c.contact ?? '(no contact on file)'}`).join(' · ')}`}
      </p>
    </div>
  )
}
