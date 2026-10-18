import type { MineEntry } from '../api/schemas'
import { itemText, money } from '../lib/format'

export function CommittedDeal({ entry }: { entry: MineEntry }) {
  const t = entry.terms
  const contacts = entry.contacts ?? []
  return (
    <div className="my-2 w-full self-center rounded-2xl border border-amber-300/30 bg-gradient-to-br from-amber-100/15 via-white/10 to-orange-200/10 p-[1px] shadow-lg shadow-black/15" data-testid="committed-deal">
      <div className="rounded-[15px] bg-stone-900/75 px-4 py-4 text-center backdrop-blur-sm">
        <div className="mb-3 flex items-center justify-center gap-2">
          <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
              <path d="m4 10 4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h3 className="text-sm font-semibold tracking-wide text-amber-100">Deal complete</h3>
        </div>
        <ul className="space-y-1 text-sm leading-relaxed text-stone-100">
          {t.gives.map((g, i) => <li key={`g${i}`}>Give {itemText(g.item)} to <span className="font-medium text-white">{g.toHandle}</span></li>)}
          {t.gets.map((g, i) => <li key={`r${i}`}>Get {itemText(g.item)} from <span className="font-medium text-white">{g.fromHandle}</span></li>)}
          {t.cashOut.map((c, i) => <li key={`o${i}`}>Pay {money(c.amountCents)} to <span className="font-medium text-white">{c.toHandle}</span></li>)}
          {t.cashIn.map((c, i) => <li key={`i${i}`}>Receive {money(c.amountCents)} from <span className="font-medium text-white">{c.fromHandle}</span></li>)}
        </ul>
        <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-relaxed text-stone-300">
          {contacts.length === 0
            ? 'Contact details are not available yet.'
            : `Arrange the rest directly: ${contacts.map((c) => `${c.handle} ${c.contact ?? '(no contact on file)'}`).join(' · ')}`}
        </p>
      </div>
    </div>
  )
}
