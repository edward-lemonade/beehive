# Intent Exchange: Concept and Behavior Spec

Working title. Name TBD.
Status: draft 2 (decisions from review folded in), for further review. Scope: product behavior only. No implementation, no technology choices.

**Current implementation scope:** location and radius are deferred. Intents do not collect or expose coordinates, and discovery does not apply geographic filtering. The location-related product behavior below is aspirational until a later scope restores it.

How to read this doc
- **[Assumed]** marks a place where I filled a hole with a default. Confirm or correct each one.
- **(Gn)** points to an entry in section 9, "Gaps, loopholes, and decisions needed."
- Every number in this doc is a proposal. Section 8 collects them.

---

## 1. Story and pitch

**Story.** Students constantly swap and sell things with each other: festival tickets, sublets, gear. It all runs through Instagram stories, group chats, and DMs. Simple deals are tedious (thirty DMs, lowballers, flakes). Complex deals ("swap my two one-day tickets for a 3-day pass," "sell all four together") are barely possible, because they depend on three or four people lining up at the same time.

**Pitch.** An exchange platform. You say what you give and what you want. Your agent finds arrangements, including multi-person ones, where everyone gets exactly what they asked for. It checks with you before anything is final, then hands you the contacts so you finish the deal off-platform. There are no listings to browse, no fees, and the platform never touches money or goods.

**Positioning.** A discovery platform, not a transaction platform. It finds and validates compatible deals and introduces the people. It does not hold goods or money, move anything, or guarantee that anyone follows through. Approving an arrangement means "I am willing to deal with these people on these terms," not "the platform vouches for them." The risk of dealing with someone you have not met is real and is disclosed up front. Trust scores reduce it but cannot remove it. The pitch should avoid words like "safe" and "secure."

**Why it is different**
- Intents, not listings. One declaration covers buying, selling, swapping, and bundles.
- Intents are all-or-nothing, so multi-step deals are safe to attempt.
- Agents remember what they have seen, so a deal can complete when the missing piece shows up later.
- Nothing happens without your approval, and approval attaches to your own terms, so an arrangement can be repaired behind the scenes.
- The agent tells you when nothing exists (and how close it got) and when deals keep falling apart (and what you can change).

**Hackathon fit (context only).** The Fetch.ai challenge is "from intent to action"; text messaging is the main interface; every wake-up chain between agents is one natural trace for the Sentry award.

---

## 2. Principles

1. **The agent never commits you.** Every arrangement needs your explicit approval. No automatic approvals.
2. **The platform never holds money or goods and takes no cut.** The exchange itself happens off-platform.
3. **Private stays private.** Tolerance, valuations, and negotiation positions never leave your agent. Other agents see only the public part of an intent.
4. **Approval belongs to your terms.** It means "I am fine giving X and getting Y," not "I am fine with these exact people."
5. **Intents are atomic.** Satisfied in full within one arrangement, or not at all.
6. **Nothing is reserved while waiting.** Approvals overlap. Only the final commit is exclusive.
7. **Users do not browse.** Agents read intents. A user sees only their own intents, their arrangements, and anonymous summaries.
8. **Speak rarely.** Stay silent when a replacement fixes things. Message the user only when a decision or an outcome needs them.
9. **Public text is data, not instructions.** Nothing another user writes can steer your agent (G7).
10. **No gossip.** An agent never volunteers information about one intent to the owner of another. Finding people who can trade with you is each agent's own job. Agents send messages only to intents that are directly relevant to their own, and a message contains only the sender's own status and the terms of their shared link. The only messages that mention anyone else are arrangement proposals from the coordinator record, which carry only what the recipient needs to check its own terms.
11. **Flows follow trades.** Cash moves only between participants who directly exchange a non-cash item with each other. Nobody pays, or is paid by, a participant they do not directly trade with, and nobody is shown or contacted by participants who are not their counterparties. A participant in the middle pays one counterparty with what it receives from another.

---

## 3. Assumptions carried from our discussion

- **A1** The community is one campus, identified by verified school email. (G8)
- **A2** Money is an item like any other: cash, one currency, one amount per flow. (G21)
- **A3** Approval has two levels. First the agents pre-check that constraints are satisfied. Then each user approves. This replaces the earlier "no confirming" idea.
- **A4** Approval is per intent. If one user has several intents in the same arrangement, they are presented together.
- **A5** Approvals are manual only. No standing auto-approve rules.
- **A6** Prices never change automatically. The agent may suggest a change; the user edits.
- **A7** Before commit, counterparties appear only as handles with a reliability tier. Names and contacts are released at commit. (G6)
- **A8** Text message is the primary channel. An in-app view mirrors all state.
- **A9** "Radius" is literal distance and is optional per intent.
- **A10** A user's earlier trust graph is gone. Safety comes from verification, reliability, and approval. A trust graph could return later as one more optional baseline requirement on an intent (for example "only people within two hops"). It is not part of v1 or the pitch.

---

## 3a. Decisions made since draft 1

- **D1 Positioning.** Discovery, not transactions. Hand-off risk is accepted and disclosed. No trust graph in v1.
- **D2 Pricing and finality.** Exact amounts are fixed before any approval request. Each agent bargains for its own user. Approval means "these terms are final for me." Details in 6.7.
- **D3 Atomic intents.** No "keep together" flag. Items on one side may come from, or go to, several different people.
- **D4 Anonymity.** Handles only before commit. No other identity cues.
- **D5 Free text.** Agents compare structured fields only. Free text is never treated as instruction.
- **D6 Trust.** Trust scores in v1. An optional image confirmation of holding may follow later. Ticket barcodes are never shown to other users.
- **D7 Sublets.** Ordinary intents carrying structured attributes in v1. Roughly compatible matches are reported as near misses. Deposits, landlord consent, and rent schedules are a later feature.
- **D8 No gossip.** An agent never tells another agent about a third intent. Each agent finds its own directly relevant intents, and an arrangement is assembled by a hub that is directly relevant to everyone else. Consequences in G22.
- **D9 Flows follow trades.** Cash moves only between counterparties, meaning participants who directly exchange a non-cash item. In S1, A pays B and B pays C. A and C never deal with each other, never see each other, and never get each other's contact details.
- **D10 No size cap.** Arrangement size is determined by the participants' items. A search budget (Section 8) bounds the work, not the deal.
- **D11 Signals, not gossip.** Agents talk only to directly relevant intents. A message carries only the sender's own status and the terms of the link they share. Nothing is ever relayed. When signals close a loop, the backend records the arrangement.

---

## 4. Key terminology

### People and agents
- **User**: a verified person.
- **Community**: the set of users whose agents can see each other's intents.
- **Agent**: one per user. It parses what the user says, reads other users' public intents, negotiates within the user's limits, finds arrangements, and messages the user.
  - Can: read public parts, pre-check arrangements, negotiate within tolerance, propose arrangements to its user, message its user.
  - Cannot: approve, commit, release contact details, reveal the private part of an intent, or go beyond the user's declared terms and tolerance.
- **Handle**: a pseudonymous label for a counterparty before commit (for example, "Party 2").
- **Reliability tier**: a coarse public rating derived from past outcomes (for example New, Reliable, Flagged).

### What is exchanged
- **Item**: anything given or wanted. Has a kind (ticket, sublet, cash, other), descriptive attributes, and a quantity.
- **Cash**: an item with an amount and no identity.
- **Item match**: the rule deciding that a given item satisfies a wanted item (same kind, compatible attributes). (G9)

### Intents
- **Intent**: a user's declaration of what they give and what they want, treated as one all-or-nothing unit.
- **Give / Want**: the sets of items on each side. A Want may list acceptable alternatives (for example "Friday or Saturday ticket"). (G9)
- **Declared terms**: the Give, Want, and amounts exactly as the user stated them.
- **Firm / Flexible**: a mark on each cash amount saying whether it can move.
- **Tolerance** (private, optional): how far beyond the declared terms the user will go (for example "up to $20 more"). Unset means "ask me."
- **Valuation** (private, optional): the user's dollar worth for non-cash items. Used only to rank arrangements and judge trade-offs.
- **Atomic**: the whole intent is satisfied in one arrangement or not at all. Items on one side may come from, or go to, several different participants.
- **Location and radius** (deferred): possible future handoff location and travel-distance preference.
- **Deadline** (optional): the date after which the intent is pointless (for example the event date).
- **Version**: every change to an intent creates a new version.
- **Public part**: declared terms, location and radius, deadline, handle, reliability tier.
- **Private part**: tolerance, valuation, negotiation history.

### Discovery
- **Notice**: a record that one agent has read a specific version of one intent. It is per (observer, intent, version). (G11)
- **Known set**: the directly relevant intents an agent has noticed, at the versions it read. Intents judged not relevant are recorded as read but never used.
- **Neighborhood**: the intents an agent is eligible to notice (same community, Open, not its own). Geographic filtering is deferred.
- **Directly relevant**: intent Y is directly relevant to intent X if, ignoring cash, some item in Y's Give could satisfy some item in X's Want, or some item in X's Give could satisfy some item in Y's Want. Cash alone never makes two intents relevant. Cash settles only between counterparties, so a buyer has no reason to be relevant to a seller it does not trade an item with.
- **Search**: looking for a closed set of directly relevant intents that includes the agent's own, using only its known set and the signals it has received.
- **Signal**: a message from one agent to a directly relevant intent saying whether the sender is satisfiable with that intent's participation. It carries no identity or terms of any third party.
- **Satisfiable**: an intent is satisfiable if every item in its Give and Want has at least one directly relevant neighbor that is satisfiable with it.
- **Coordinator record**: backend bookkeeping created when signals close a loop. It holds the participant list, freezes terms, and runs commit. It is not an agent and sends only proposals.
- **Wake event**: anything that makes a resting agent search again. A signal is received or retracted.
- **Dormant**: an Open intent whose agent has exhausted its neighborhood and stopped actively searching.
- **Near miss**: something close to workable but outside the user's declared terms and tolerance. Reported anonymously, never proposed. Example: sublet dates that overlap only partly.

### Arrangements
- **Arrangement**: a set of intents from two or more users, plus the resolved flows between them, where every intent is satisfied in full and cash balances to zero across all participants, with each cash flow running between counterparties only.
- **Participant / slot**: one intent's position in an arrangement.
- **Flow**: a transfer of one item or an amount of cash from one participant to another.
- **Counterparty**: within an arrangement, a participant with whom you directly exchange at least one non-cash item. Cash moves only between counterparties. Each pair of counterparties is a **trade link**, priced by the two agents that share it.
- **Terms (of a participant)**: what that participant gives, to whom (handle); what they get, from whom; the cash in and out; the difference from their declared terms.
- **Grade**: Exact (matches declared terms), Within tolerance (worse than declared but acceptable), Near miss (outside tolerance; informational only).
- **Revision**: a version of an arrangement after a slot is replaced or terms change.
- **Frozen**: once approval requests for a revision go out, its amounts do not change. Any change creates a new revision.
- **Pre-check**: each participant's agent confirms the arrangement satisfies its constraints, using current versions.
- **Negotiation**: agents exchange proposals to settle concrete amounts, each within its own limits.

### Approval and commit
- **Approval**: a user's explicit yes to their own terms in an arrangement.
- **Void**: an approval that no longer applies because the terms it covered changed.
- **Freshness**: how long an approval stays trusted before the user is asked "still good?"
- **Commit**: the single indivisible moment when all conditions hold and the arrangement becomes final.
- **Replacement**: a new intent filling a vacated slot with the neighbors' terms unchanged.
- **Dissolved**: the terminal state of an arrangement that did not commit.

### After commit
- **Hand-off**: the off-platform exchange itself.
- **Hand-off checklist**: each participant's personal list of who gives what to whom.
- **Follow-up**: later check-ins asking how the hand-off went.
- **Outcome**: Completed, Partial, Problem, or No response.
- **Reopen**: creating a fresh Open intent from a Done one.

### Health signals
- **Reliability**: a score derived from approvals, outcomes, timeouts, and reports.
- **Infeasible**: no arrangement exists for an intent.
- **Brittle**: arrangements keep forming and then falling apart.

---

## 5. How the app works (overview)

1. **Say it.** The user texts or types what they give and want. The agent turns it into a draft, asks questions about missing essentials, and shows it back. The user confirms. The intent is now Open.
2. **Search.** The agent reads the intents in its neighborhood, records what it has read, and keeps only those directly relevant to its user's intent. It looks for arrangements it can assemble as hub. It never passes on, or asks about, anyone else's neighbors. Nothing is shown to anyone yet.
3. **Rest.** If nothing works, the agent tells the user once, with the closest near misses, then goes Dormant. It wakes when something relevant changes.
4. **Propose.** When an agent finds an arrangement, it asks the other participants' agents to pre-check it. Agents may negotiate amounts first.
5. **Approve.** Each participant's user is asked to approve their own terms. Approval is non-exclusive and can sit waiting.
6. **Repair.** If someone declines or vanishes, agents look for a replacement with identical terms for everyone else. Approved users are not bothered.
7. **Commit.** When every participant has a valid approval at the same moment, the arrangement commits. All involved intents are closed, contacts are released, and each person gets a checklist.
8. **Finish off-platform.** Users complete the deal themselves. The platform follows up later, records outcomes, and offers a one-tap reopen if something failed.

```
Draft -> Open (Searching / Dormant) -> arrangement Proposed
      -> approvals collected (replace slots as needed)
      -> Committed -> Hand-off -> Follow-up -> Outcome recorded
```

---

## 6. Detailed behavior

### 6.1 Creating an intent
- Input is free-form text. The agent parses it into a **Draft**.
- Essentials the agent must resolve before the draft can be confirmed:
  - what the user gives and wants, with quantities;
  - for tickets: event, ticket type, day;
  - for sublets: dates and rent;
  - any cash amount, and whether it is firm or flexible;
  - whether multiple units on one side are sold or bought separately or only together. The agent must always ask this when a side has more than one unit, because it decides atomicity: separate intents sell independently, while one intent clears as a whole.
- Optional, asked at most once and never insisted on: tolerance, valuation, deadline. Location and radius are deferred in the current implementation.
- The agent shows the draft back in plain language. The user confirms, edits, or abandons.
- Outcomes:
  - Confirmed: becomes Open.
  - Edited: remains Draft.
  - Abandoned or expired: Discarded.
  - Rejected: the agent says why (item type not supported, nothing but cash on either side, open-intent limit reached, a policy issue).
- A Draft is invisible to everyone else.

### 6.2 Intent states

| State | Meaning | Visible to other agents | User can |
|---|---|---|---|
| Draft | Parsed but not confirmed | No | Edit, confirm, abandon |
| Open | Live and matchable | Yes (public part) | Edit, withdraw, widen radius, adjust tolerance |
| Done | Committed in an arrangement | No | View history, Reopen |
| Withdrawn | Taken down by the user | No | View history, Reopen |
| Expired | Deadline passed or renewal not given | No | View history, Reopen |

Notes
- Edits to an Open intent create a new version (see 6.13).
- A Done, Withdrawn, or Expired intent cannot be edited. Reopen creates a new intent with the same declared terms, which the user can edit before confirming.
- Intents that are Open stay Open until a state change above. They are not removed by the system except through Expired.

### 6.3 Flags on Open intents
- **Searching**: the agent is actively examining its neighborhood.
- **Dormant**: the neighborhood is exhausted. The agent has stopped searching but the intent stays visible and can be pulled into arrangements found by others.
- **Has proposals**: at least one arrangement is waiting for this user's approval.
- **Waiting**: this user approved at least one arrangement that is still waiting for others.
- Has proposals and Waiting can be true at the same time. Dormant cannot be true while Has proposals or Waiting is true.

### 6.4 Discovery

**Noticing**
- An agent reads the public part of an intent and records the version it read.
- A notice goes stale when the intent gets a new version. A stale notice is never trusted: before an arrangement is proposed, every intent in it is re-read at its current version. (G11)
- Reading is how an agent judges whether an intent is directly relevant. An intent judged not relevant is recorded as read and then left alone: the agent does not pass it on, store it for chaining, or mention it to anyone. If it later gets a new version, a wake event makes the agent judge it again.

**Neighborhood and compatibility**
- In the current implementation, an intent is in an agent's neighborhood if it is in the same community, is Open, and is not the agent's own. Geographic filtering is future work.
- Optional baseline requirements (for example a minimum reliability tier) apply in both directions.
- Relevance is judged separately from the neighborhood. An intent is directly relevant only if a non-cash item can flow between it and the agent's own intent (see terminology).

**Wake events**
- A new intent opens in the neighborhood.
- A known intent gets a new version.
- A known intent is closed (Done, Withdrawn, Expired).
- The user edits their own intent, widens the radius, or says "keep looking."
- A periodic re-check, as a safety net in case an event was missed. (G13)

**Search**
- Each agent computes its own status from the signals of its directly relevant neighbors. It sends a signal only to those neighbors, and only about itself.
- A signal is retracted the same way when a neighbor withdraws, declines, expires, or changes. Retraction propagates along relevance edges.
- When every intent in a connected set is satisfiable with its neighbors in the set, the backend creates the arrangement record. Duplicates are one arrangement, identified by participants and intent versions.
- Future location-aware behavior: every pair that trades directly must be radius-compatible. Non-counterparties are never compared.

**Passive participation**
- Every participant answers the pre-check using only its own flows, its counterparties' handles, and what it needs to check radius. An intent can be included in an arrangement assembled by another agent (the hub), whether or not it is Dormant and whether or not its own agent ever read the other participants. Its agent answers the pre-check using only what the proposal gives it (its own flows, the handles involved, and what it needs to check radius), and its user is asked to approve like any other participant.

### 6.5 Dormancy and near misses

**Entry.** An intent becomes Dormant when: every intent in its neighborhood has been read at its current version and judged for direct relevance, the agent can assemble no valid arrangement as hub at Exact or Within-tolerance grade, and the intent has no pending arrangements. Dormant does not mean nothing exists: another agent may still assemble an arrangement that includes this intent. (G13, G22)

**What the user gets, once, on entry.**
- A plain statement that the agent found nothing it can assemble from people directly relevant to the user, and that arrangements put together by others can still reach them.
- How many intents were examined.
- Near misses in anonymous form ("I haven't found anyone selling for under $300; the lowest is $315").
- Options: wait (default), widen radius, adjust terms, negotiate further with a specific handle, withdraw.

**While Dormant.** The agent stops searching. The user can wait, or tell the agent to keep negotiating with a particular handle or to search a larger radius. Either instruction ends dormancy until the agent has exhausted the new scope.

**Exit.** Any wake event (see 6.4) ends dormancy.

**Informational notices.** Between dormancy and a working arrangement, the agent may send an update when something material changes (a lower price appears, a new near miss). These are rate-limited per intent. Near-miss information comes only from public parts and never identifies anyone.

**If the user replies "OK to $320"** to a near miss, the agent proposes updating the user's tolerance, asks for confirmation, then resumes searching.

### 6.6 What makes an arrangement valid
An arrangement is valid only if all of these hold:

1. **Atomic satisfaction.** For every participating intent, every Give item is delivered and every Want item is received, in the stated quantities, within this arrangement.
2. **Conservation.** Every item given by someone is received by someone in the arrangement. Cash balances to zero overall, and each cash flow runs between two counterparties (rule 13). The platform takes none.
3. **No self-flow.** No item or cash flows from a user to themselves. A user may have several intents in one arrangement.
4. **Compatibility.** (Future location-aware behavior) Every pair of participants with a direct flow is radius-compatible. No intent is past its deadline, and the deadline leaves room for hand-off. (G18)
5. **Terms within bounds.** Each participant's terms are their declared terms or within their tolerance. Anything worse is a near miss, never proposed for approval.
7. **Community and baseline.** All participants meet each other's baseline requirements.
8. **Item match.** Every wanted item is matched to a given item by the item-match rule. Fuzzy matches are shown to the user for review. (G9)
9. **Freshness.** Every intent is used at its current version.
10. **Not previously declined.** No participant has already declined an identical arrangement for the same intent version.
11. **Fully priced.** Every flow has an exact amount. An arrangement with any unsettled amount is never proposed.
12. **Connected shape.** The participants form a connected set in which every adjacent pair is directly relevant, ignoring cash.
13. **Flows follow trades.** Cash moves only between counterparties, meaning participants who directly exchange a non-cash item in this arrangement. Nobody pays, or is paid by, a participant they do not directly trade with. A participant in the middle pays one counterparty with what it receives from another. Contact details are released only between counterparties.

**Ranking.** When a user has several candidate arrangements, they are ordered: Exact before Within tolerance; then better net result for the user (valuation if set, otherwise cash difference); then fewer participants; then higher reliability tiers of others. (G12)

### 6.7 Negotiation, pricing, and finality
- **Exact amounts come first.** An arrangement is never shown to users until every flow has an exact amount. Agents settle amounts among themselves before any user is asked.
- **Each agent bargains for its own user only, and only with its own counterparties.** Each trade link is priced by the two agents that share it. An agent may move a Flexible amount within its user's tolerance. A Firm amount cannot move. Agents exchange proposals and accept or reject. They may disclose the final acceptable terms as a negotiated result, never tolerance or valuations.
- **One negotiation per link.** Each trade link is priced by the two agents that share it. No agent coordinates the others. The coordinator record freezes amounts once every link is Agreed.
- **Freeze.** When approval requests for a revision go out, its amounts are frozen. Approval means "these terms are final for me."
- **Changes after a request is out** (a user's "negotiate further," a counterparty bargaining again, a user edit) create a new revision. Approvals whose terms changed become void; the rest carry over. [Proposed] A revision cap per arrangement: when it is reached, the arrangement dissolves as unstable, so users are not asked again and again.
- **Fallback when bargaining stalls.** [Proposed] If both sides' ranges overlap but agents do not converge within the round limit, the receiver's declared ask applies when the payer's terms allow it. If they do not, the pairing is a near miss. If the receiver declared no ask (a participant in the middle, like B in S1), the amount that leaves the receiver at zero net cash applies.
- Negotiation ends as: **Agreed** (amounts fixed, requests go out), **Failed** (a participant cannot or will not move), or **Stalled** (round limit reached; the fallback applies).
- A user can trigger further bargaining ("negotiate further") with a target. It follows the same revision rule.

### 6.8 Arrangement states

| State | Meaning | Visible to users |
|---|---|---|
| Candidate | One agent's idea, not yet checked with others | No |
| Dropped | Failed a pre-check | No |
| Proposed | Passed pre-checks; collecting approvals | Participants are asked |
| Committed | All conditions held at once; final | Yes |
| Dissolved | Ended without committing | Only to users who had approved and need to know |

Reasons an arrangement dissolves
- A participant declined and no replacement was found in time.
- A participant timed out and no replacement was found in time.
- A participant retracted, withdrew, or let their intent expire, and no replacement was found.
- An intent changed so the arrangement is no longer valid.
- An intent was consumed by another committed arrangement, and no replacement was found.
- The arrangement lifetime cap passed.
- A better variant of the same participants superseded it.

### 6.9 Approval

**What the user sees**
- What they give, to whom (handle); what they get, from whom (handle); cash in and out.
- The grade and the difference from their declared terms, in plain words ("this is $10 worse than you asked").
- Each counterparty's handle and reliability tier. Participants who are not the user's counterparties are never shown.
- Item details worth double-checking.
- The response deadline.

**Options**
- **Approve.** The agent replies "I'll let you know as soon as the others approve." The intent gets the Waiting flag.
- **Decline this arrangement.** Keep looking.
- **Decline and withdraw my intent.**
- **Negotiate further.** With a target, or with a specific handle.
- **Adjust my intent.** Creates a new version and voids this approval request.
- **Something else.** Free-text instruction to the agent.

**Approval states**

| State | Meaning |
|---|---|
| Queued | Waiting because the user has too many open requests |
| Requested | The user has been asked |
| Approved | The user said yes to these terms |
| Declined | The user said no to this arrangement |
| Declined and withdrew | The user said no and took the intent down |
| Timed out | No answer before the deadline |
| Retracted | The user took back an approval before commit |
| Void | The terms changed, or the approval went stale |
| Fulfilled | The arrangement committed |

**Validity.** An approval covers the user's terms (items, cash, and difference) in a specific intent version. It stays valid across revisions, and across different arrangements, where those terms are identical. It may also stay valid if cash improves in the user's favor. (G15) It becomes Void when the intent's public terms change, or the user's terms in a new revision differ in any other way.

**Freshness.** An approval older than the freshness window triggers a "still good?" check. No answer is treated as a timeout. (G10)

**Retraction.** Allowed until commit. Retracting after everyone else has approved is the most disruptive form and counts against reliability. (G14)

**Pending cap.** A user is asked about at most a few arrangements at once, in ranking order. The rest wait as Queued. (G12)

**Replying by text.** Each request carries a short reference. When several are open, the reply must name one. (G16)

### 6.10 Replacement and re-forming
- **Triggered** when a slot is vacated: a decline, a timeout, a retraction, a withdrawal, an expiry, a change that invalidates the intent, or an intent consumed elsewhere.
- **Retraction propagates, and the neighbors of the vacated slot re-evaluate.** Any directly relevant Open intent that can fill the slot, with every remaining participant's terms identical (or better in cash), produces a new revision. The replacement must pass pre-checks and every participant's baseline.
- **Result:** a new revision of the same arrangement. Existing approvals carry over. The new participant is asked, with their own approval window.
- **Several candidates:** the best by ranking goes first. The others wait as alternates.
- **Not found in time:** the arrangement dissolves. Users who had approved are told once.
- **Smaller arrangements:** if the remaining participants can form a valid smaller arrangement, that is a new arrangement. Existing approvals carry only for users whose terms are unchanged; everyone else is asked again.
- **Declined arrangements** are remembered per user so an identical one is never asked again.
- A decliner never gets a replacement slot in the same arrangement.

### 6.11 Commit
**Conditions, all checked together as one step**
1. Every participating intent is Open at an approved version.
2. Every approval is valid and fresh.
3. All validity rules in 6.6 still hold.
4. No participating intent has already been consumed by another commit.

**Effects**
- All participating intents become Done.
- Every other arrangement containing any of them dissolves ("consumed elsewhere"). Replacement attempts start for the vacated slots.
- Contact details are released, only between counterparties. (G3, G6)
- Each participant receives a hand-off checklist. (G1)
- Follow-ups are scheduled.

**If two arrangements are ready for the same intent at once,** one commits and the other dissolves. The platform need not say which came first, only that exactly one wins.

**If the commit conditions fail at the last moment,** nothing is committed. The arrangement goes back to collecting approvals or dissolves, depending on which condition failed.

**Point of no return.** After commit, the platform no longer controls the outcome. A user can still back out off-platform.

### 6.12 Hand-off and follow-up

**Hand-off checklist (per participant)**
- What I give, to whom (name and contact).
- What I get, from whom.
- Cash I send, to whom. Cash I receive, from whom.
- A suggested order of steps. (G1)
- A way to mark each step done.

**Follow-up**
- First check-in after the follow-up delay, then reminders, then close as No response.
- Each participant reports: Completed, Partial, Problem, or No response.
- Problem opens a short guided report flow and offers Reopen.
- Outcomes update reliability.

**Reopen.** Creates a new Open intent from the old declared terms. The old one stays Done. (G17)

### 6.13 Edits, withdrawals, expiry: effects

| Event | Effect on the intent | Effect on arrangements and approvals | Who is told |
|---|---|---|---|
| User edits public terms | New version; searches again | This intent's approvals void; others' approvals void only if their terms change; arrangements revalidated, replaced, or dissolved | The user, if they had pending requests |
| User edits private part (tolerance, valuation) | New version | Approvals stay valid (their terms did not change); grades recalculated; unapproved requests that fall outside tolerance are withdrawn | The user |
| User withdraws | Withdrawn | Slot vacated; replacement attempted; arrangement dissolves if not replaced | Approved users, only if it dissolves |
| Intent expires | Expired | Same as withdraw | The user; approved users only if it dissolves |
| Intent consumed by commit | Done | Other arrangements dissolve or get replacements | Approved users, only if they dissolve |
| User declines | Open (unless withdrawn) | Slot vacated; replacement attempted | No one else |
| User times out | Open | Treated like a decline | The user, once |
| User retracts | Open | Treated like a decline; reliability note if late | No one else |
| User's account is removed or banned | Intents withdrawn | As withdraw | Affected approved users, if arrangements dissolve |

### 6.14 Brittleness and advice
The agent tracks, per intent, how many arrangements were proposed and how many dissolved, and why. It sorts the problem into two kinds, because the advice is different.

- **Infeasible.** No arrangement exists at Exact or Within-tolerance grade.
  - Show the nearest miss and the gap ("lowest ask is $315, you are at $300").
  - Suggest changing terms: price, dates, alternatives, radius.
- **Brittle.** Arrangements keep forming and then dissolving for reasons outside the user's terms (declines, timeouts, withdrawals by others).
  - Say where they collapse ("three attempts fell through because other people did not respond").
  - Do **not** suggest changing price: it will not help.
  - Suggest waiting, widening radius, or requiring a higher reliability tier for counterparties.
- The agent tells the user once when the brittleness threshold is crossed, then not again until something changes.

### 6.15 Notifications

| Notification | Trigger | Recipient | Limits |
|---|---|---|---|
| Draft confirmation | Parsed draft ready, or a question to resolve | Creator | Only while a draft is open |
| Approval request | Arrangement proposed or revised with changed terms | Each participant | Pending cap; queued beyond it |
| Approval acknowledged | User approves | That user | Immediate |
| Waiting update | Still collecting approvals after the waiting threshold | Approved users | Once per arrangement |
| "Still good?" | Approval older than the freshness window | Approved user | Once per approval |
| Committed | Commit | All participants | Includes contacts and checklist |
| Dissolved after approval | Arrangement dissolved and the user had approved | Approved users | Once |
| Dormancy | Intent becomes Dormant | The user | Once per entry |
| Near-miss update | Material change in near misses | The user | Minimum interval per intent |
| Brittleness advice | Threshold crossed | The user | Once until something changes |
| Intent expiring | Close to deadline or renewal | The user | Once |
| Follow-up check-in | After commit | Each participant | A few reminders, then close |
| Account notice | Warning, flag, or removal | The user | As needed |

Quiet hours apply to everything except time-critical messages. (G16)

### 6.16 Trust and safety baseline
- Verified account: school email and phone number. One account per person.
- Reliability tiers shown on handles. New users start as New.
- Report flow available after commit.
- Flagged users are excluded from arrangements by default until reviewed.
- Open-intent limit per user. (G20)
- Trust scores are the main safety layer in v1. An optional image confirmation of holding may be added later (see G2).
- Details unresolved: G3, G14.

### 6.17 Location and radius
Location and radius are deferred from the current implementation. Intents do not collect coordinates, and discovery does not filter by distance. This section describes possible future behavior only:
- Users would never be asked for an address.
- A user could set one location point with a map pin; place names would not be geocoded.
- The exact point would stay with its owner. Other users and agents would see only a coarse point.
- A user could set a distance radius, with a default if omitted.
- Distance checks would run only between pairs that trade directly.

### 6.18 Map UI
The map is deferred with location support. The current UI scope is the public intent feed specified in `docs/09_map_ui.md`; the following map behavior is future work.
- The map shows every Open intent in the user's community as a bubble at its coarse point. The bubble carries the intent's free text. Users can pan, zoom, and browse freely.
- A bubble shows the free text (sanitized and labeled, G7), the handle, and the reliability tier. It never shows contact details or any private part.
- Location-free intents have no point, so they appear in a separate strip beside the map.
- The user's own intents are highlighted. This is where the user drops or moves their pin (6.17).
- The map updates live: a bubble changes or disappears when its intent gets a new version or is closed.
- The map never shows arrangements, signals, or who else is in an arrangement. Those stay in the approval flow.
- **Message their agent.** Tapping a bubble offers this action. It starts the same negotiation that agents run on their own (6.7), with the user's agent speaking for them within their limits. [Proposed] It is allowed only for intents that are directly relevant to the user's own. For any other bubble, the agent tells the user it is not a potential trade and sends nothing.
- The result enters the normal flow: pricing per link, signals, approval, commit.
- The map is optional. The agent searches and negotiates in the background whether or not the user opens it.

---

## 7. Scenarios

**S1. Three-party happy path (your example).**
A wants ticket1 and gives cash P. B gives ticket1 and wants ticket2, with no cash terms of its own. C gives ticket2 and wants cash Q (Q at most P, so that B can resell without loss).
1. A opens an intent. No neighbors, so A goes Dormant after a first notice.
2. B opens an intent. A and B notice each other. No arrangement: B wants ticket2 and A can only give cash. Both Dormant.
3. C opens an intent. A's and B's agents both read it. A sees that C offers ticket2, which A does not want, so C is not relevant to A. A leaves it at that and tells no one. B sees that C offers ticket2, which B wants, and B already knows that A wants the ticket1 that B gives. Both A and C are directly relevant to B, so B is the hub. B assembles the arrangement: B buys ticket2 from C, and B sells ticket1 to A. B coordinates the pricing. It bargains with C over what B pays for ticket2, and with A over what A pays for ticket1. A and C never deal with each other. B's net cash is the difference between the two amounts. B's declared terms had no cash, so B's grade is Exact when the net is zero or better.
4. B asks A's and C's agents to pre-check. Each checks only its own user's terms, and both pass. Each user is asked. A approves, then B, then C.
5. On the last approval, commit. All three intents are Done. A and C each get B's contact details, and B gets both. A and C get nothing about each other. Checklists go out.

**S2. A participant declines; a replacement is found.**
A and B have approved. C declines. C's slot is vacated and C's declined arrangement is remembered. Another user D gives ticket2 and asks no more than C did. The replacement is a new revision: A's and B's terms are identical, so their approvals carry over. D is asked. D approves. Commit. A and B never knew.

**S3. No replacement found.**
Same as S2 but nobody can fill C's slot within the replacement window. The arrangement dissolves. A and B, who had approved, are told once. Both return to Searching.

**S4. Two arrangements compete.**
A has approved arrangement X (with B and C) and arrangement Y (with D and E). Y collects its last approval first and commits. A's intent is Done. X dissolves as "consumed elsewhere." B and C each lose a slot: a replacement is attempted for A's slot, and they are told only if it fails.

**S5. A user edits mid-approval.**
B changes their want from ticket2 to ticket3. B's version changes, and all B's approvals become Void. The arrangement with C no longer works (C gives ticket2), so it dissolves. A and C, who had approved, are told once if no replacement appears.

**S6. Near miss, then tolerance.**
A wants a ticket for at most $300. The cheapest seller asks $315. A's tolerance is unset, so nothing is proposed. A gets a near-miss notice. A replies "OK to $320." The agent proposes updating tolerance, A confirms, and the agent searches again.

**S7. Dormancy and wake.**
A is Dormant. B, a known neighbor, lowers their price. This is a new version of a known intent, so a wake event fires. A's agent re-reads it, finds a valid arrangement, and proposes it.

**S8. Multi-unit intents.**
Four separate intents: four tickets can sell to four different buyers, in any order. One atomic intent for all four: the whole set must clear in one arrangement; it may go to several different buyers. If a buyer wants two tickets and the seller has four separate intents, the arrangement includes two of the seller's intents. The seller sees one combined approval request.

**S9. Better-than-approved replacement.**
A approved paying $300. The replacement seller asks $290. A's cash improved, so A's approval carries and no new question is asked. (Subject to G15.)

**S10. Swap with cash top-up (the $10 example).**
The user gives a Friday ticket and a Saturday ticket and wants a 3-day ticket. Two buyers (Friday $150, Saturday $140) and a seller ($300, firm) fit. The user's agent is the hub, since all three are directly relevant to the user's intent. The user's net cash is minus $10, beyond declared terms. If the user's tolerance covers it, the grade is Within tolerance and the request says "$10 worse than you asked." If tolerance is unset or smaller, it is a near miss and the user gets an informational notice with options (negotiate further, adjust terms, keep looking).

**S11. Failure after commit.**
In S1, C never delivers ticket2 to B. B reports a Problem and C's reliability drops. A's deal with B is a separate exchange, so A's outcome depends only on B. B chooses the order of its two legs: completing the purchase from C first means A never waits on a leg that has not happened. B reopens a fresh intent for ticket2. The platform cannot recover anything. (G1, G17)

---

## 8. Parameters (all proposals)

| Parameter | Proposed value |
|---|---|
| Draft expiry | 48 hours |
| Open intent renewal | Every 14 days or at the deadline, with a reminder 48 hours before |
| Max open intents per user | 10 |
| Approval window | 24 hours |
| Replacement window per vacated slot | 24 hours |
| Arrangement lifetime cap | 72 hours from first proposal |
| Approval freshness | 48 hours |
| Waiting update threshold | 24 hours in Waiting |
| Pending approval requests per user | 3 |
| Search budget | 200 candidate expansions or 5 seconds. Takes the best arrangement found so far. |
| Negotiation rounds per revision | 5 |
| Revisions per arrangement before it dissolves as unstable | 5 |
| Brittleness threshold | 3 dissolutions caused by other parties within 7 days |
| Informational notice minimum interval | 24 hours per intent, unless something material changes |
| Follow-up schedule | 24 hours after commit, reminders at 72 hours and 7 days, then No response |
| Quiet hours | 10 PM to 8 AM user local time |
| Reliability tiers | New, Reliable, Flagged |
| Default radius | 3 miles |
| Coarse location grid | About 500 m |

Every duration needs a demo-speed setting.

---

## 9. Gaps, loopholes, and decisions needed

### Critical: these can break the product or hurt people

**G1. Hand-off risk.**
- Problem: The platform never holds goods or money, so a flaky or dishonest participant can hurt the people they deal with. Because flows follow trades (D9), every exchange is between two direct counterparties, which is an ordinary bilateral deal that can be done in person at the same time. What remains is the hub: its legs are coupled, so a failure on one leg can leave it stuck with the other, and a counterparty of the hub may end up waiting on a leg that depends on someone else. The order of the hub's legs is undefined, and cash timing adds risk (in S10 the user fronts $10 before collecting).
- Proposed default: suggest that any participant in the middle completes the legs where it receives before the legs where it gives, so counterparties never wait on a leg that has not happened; disclose the residual risk plainly.
- **Decided:** the platform does discovery only. Hand-off risk is accepted and disclosed (D1), and flows follow trades (D9), so nobody depends on a counterparty they do not directly deal with, except through the hub.
- Still open (information only, no custody): whether the approval request tells a counterparty of the hub that the hub's deal depends on another leg, and whether arrangements of three or more require a minimum trust tier.

**G2. Item authenticity and double listing.**
- Problem: Nothing verifies that a user holds the ticket or the sublet they give. The same ticket can be listed in two intents, by mistake or on purpose. Some ticket sellers forbid transfers or require name matches.
- **Decided direction:** trust scores in v1; an optional image confirmation of holding may follow. Images are a weak signal because they are easy to fake. Ticket barcodes and QR codes must never be shown to other users or agents, since a leaked code can be copied and resold. Use any submitted proof only for duplicate detection. Also: reliability tiers and Problem reports. State clearly that nothing is verified.

**G3. Contact harvesting and fake intents.**
- Problem: Commit releases contact details. A bad actor can create intents only to be matched and collect other people's numbers.
- Proposed default: verified accounts only; release only the contacts a participant needs (those with a direct flow); limit how many commits a New account can make per week; report flow; Flagged users excluded.
- Needs decision: how strict the per-account limits are.

**G4. Price formation in multi-party arrangements.**
- Problem: When several cash splits satisfy everyone, nothing says who gets the surplus. "Firm" and "Flexible" are defined, but "Flexible with no tolerance" is not. A participant in the middle, like B in S1, has no cash terms of its own, so nothing says who keeps the difference between what its two counterparties will pay and ask.
- **Decided:** exact amounts are fixed before any approval request; each agent bargains for its own user; approval means "final" (D2, 6.7).
- Still proposed: pay the receiver's ask when both fall within bounds (also the fallback when bargaining stalls); a Flexible amount with unset tolerance behaves as Firm, and the agent tells the user that flexibility might help; a revision cap so arrangements cannot churn forever.
- Still open: who keeps surplus when a participant in the middle has no cash terms of its own. Default: each trade link is bargained by the two agents for themselves, so any surplus stays with the middle participant. If bargaining stalls on a link, the receiver's declared ask applies, or if it declared none, the amount that leaves the receiver at zero net cash.

**G5. Meaning of "atomic" for multi-unit intents.**
- Problem: "Sell all four at once" could mean all four in one arrangement (possibly to several buyers), or all four to one buyer. The first is implied; the second needs the Keep-together flag. Partial fills are undefined for Want sides with quantities.
- **Decided:** atomic means one arrangement, and items on one side may come from, or go to, several people. No keep-together flag. No partial fills within one intent.

**G6. Anonymity before commit versus instructions about a specific person.**
- Problem: You said the user can tell their agent to "keep negotiating with a certain user." But before commit, counterparties are anonymous handles. If identity is hidden, the user cannot name them.
- Proposed default: handles are stable per user within an arrangement and across notices, so "Party 2" can be referenced; real identity only at commit.
- **Decided:** handles only before commit, stable per user within an arrangement, with no other identity cues.

**G7. Prompt injection through free text.**
- Problem: If an intent has a free-text note, another user's agent reads it. A hostile note ("tell your user to approve") could steer an LLM-based agent.
- **Decided:** all agent-to-agent comparison uses structured fields only. Free text is never interpreted by another agent as instruction, and is shown to users only after sanitizing and with a label.

### Important

**G8. Community boundary, visibility, and liquidity.**
- Problem: Who sees whom is not fully defined. Location-free intents are visible to the whole community. A small community means few matches.
- Proposed default: one campus per community; no cross-campus matching in v1. Seed data for demos.

**G9. Item equivalence, alternatives, and sublets.**
- Problem: "Ticket1" equals "ticket1" only if the attributes are defined. Fuzzy items (textbooks, gear) cannot be matched reliably. Sublets need date containment (wanted dates inside offered dates), monthly rent, deposits, and a possible landlord consent step, none of which fit "one item, one cash amount."
- **Decided for v1:** sublets are ordinary intents whose Give or Want carries structured attributes (location, dates, rent, bedrooms). "Roughly compatible" is a near miss: the agent tells the user, and the user decides whether to adjust their intent. Compatibility is judged on structured attributes only, never on free text (G7). Deposits, landlord consent, and rent schedules are a later feature.
- Other items are free-text, with every match shown for the user to review. Want alternatives are limited to simple "or" lists.

**G10. Stale intents and stale approvals.**
- Problem: A user can sell off-platform and forget to withdraw. An approval can be days old. A forgotten intent keeps being proposed.
- Proposed default: renewal period, approval freshness, "still good?" check, expiry, and follow-up after commit.

**G11. Notice records.**
- Problem: "Noticed" was described as a flag per agent pair. Users can have several intents, and intents change. A flag per pair cannot tell which intent or version was read.
- Proposed default: per (observer, intent, version). A hub's reuse of what it read earlier is only a hint: it must be re-validated against current versions before proposing.

**G12. Duplicate and conflicting arrangements.**
- Problem: Several agents can find the same arrangement at the same time. A user can be in several arrangements at once, and asked about all of them.
- Proposed default: arrangement identity = participants + intent versions (flows belong to the current revision); pricing is per link, so there is nothing to compete over; ranking per 6.6; pending cap per user; commit decides conflicts.
- Needs decision: the ranking order.

**G13. Dormancy edge cases.**
- Problem: An empty neighborhood means a new user is Dormant immediately. "Exhausted" is defined, but a lost wake event would leave an intent asleep forever. A single change by a popular neighbor can wake many agents at once.
- Proposed default: periodic re-check as a safety net; one dormancy notice per entry; wakes batched so an intent re-examines at most once per interval.

**G14. Griefing, reliability, and false reports.**
- Problem: A user can approve, hold others in Waiting, then vanish or retract at the last moment, repeatedly. Reliability is easy to define but hard to protect from false reports and has no appeal.
- Proposed default: count late retractions, timeouts, and reported Problems against reliability; require two reports from different participants before a Flagged tier; human review of Flagged. Needs decision: appeal process.

**G15. Approval edge cases.**
- Problem: When does a revision count as "the same terms"? Better cash for the approver is assumed fine, but a replacement with a lower reliability tier than the approver saw is not covered. Sub-arrangements change terms.
- Proposed default: identical terms, or better cash; a replacement whose reliability tier is lower than that of any participant the approver saw requires asking again.

**G16. Text reply ambiguity, quiet hours, and delivery failure.**
- Problem: A reply of "yes" is ambiguous with several open requests. A message at 3 AM is bad. A commit notice that fails to deliver leaves a participant unaware that contacts were shared.
- Proposed default: reference codes; quiet hours; retries; the in-app view always shows the authoritative state; a commit notice must be delivered or the user must see it on next open.

**G17. Post-commit failure and recourse.**
- Problem: When an off-platform deal fails, nothing can be recovered. Reopen semantics need a rule: does the user keep priority? Who can reopen when only part of an arrangement completed?
- Proposed default: Reopen creates a normal new intent with no priority; reports adjust reliability; clear disclaimers at onboarding and in the checklist.

**G22. Discovery is limited to hub-shaped arrangements.**
- Problem: With no gossip, only a participant who is directly relevant (ignoring cash) to every other participant can find an arrangement. Three-way item swaps and star shapes work, where one person trades with all the others (S1 and S10). A longer chain does not: if A needs something from B, B from C, and C from D, and nobody is directly relevant to everyone else, no agent can see the whole chain.
- Related: a Dormant agent can truthfully report "nothing I can assemble" while an arrangement that includes it exists, because the hub is the one that finds it. If the hub leaves, the others cannot reassemble on their own.
- Cash is deliberately not a basis for relevance. If it were, every buyer would be relevant to every seller, and the rule would filter nothing. Cash also never links non-counterparties, because flows follow trades (D9).
- Proposed default: accept the limit in v1. It stops agents from inferring anything about third parties, keeps search cheap, and covers the main cases (purchases, swaps, swaps with a cash top-up, selling a bundle to several buyers). Messages to users say "nothing I can assemble," never "nothing exists."
- Needs decision: confirm the limit, or allow a controlled extension later (for example, an agent may ask a direct neighbor whether it has a supplier for a named item, without naming anyone else).
- **Resolved:** Signals propagate along relevance edges (D11). Chains work. An agent can still truthfully say only "nothing I can assemble," because another intent's signals may complete a loop later.

**G23. What a counterparty is told about a dependence it cannot see.**
- Problem: In S1, A's deal depends on C, because B can only sell ticket1 if B gets ticket2, and the arrangement commits atomically. Under D9 and D8, A must not learn who C is. But if A is told nothing, A approves a deal without knowing it hinges on someone else, and the delay or failure when C backs out looks unexplained.
- Proposed default: A's approval request and its status messages say "this arrangement includes one other participant you will not deal with," never naming them or what they trade. A is told about revisions or replacement in the same words as any other change.
- Needs decision: confirm this wording, and whether A may opt out of arrangements with hidden dependencies.

**G24. A participant in the middle carries both legs.**
- Problem: B takes both legs, so B alone bears the risk that one leg fails after the other happens (buys ticket2, cannot sell ticket1). B also has no declared cash terms, so the margin between the two links is undefined in who earns it, and a participant in the middle could be tempted to inflate the margin by bargaining hard against both neighbors.
- Proposed default: the participant in the middle's approval request shows both links and its net cash up front, and the participant in the middle is warned about the sequencing risk (receive before giving, G1). Margin is allowed but visible to the participant in the middle only.
- Needs decision: whether a participant in the middle with no declared cash terms is allowed in v1, or whether a participant in the middle must state a minimum net.

### Minor and policy

**G18. Deadlines versus hand-off time.** An arrangement committed close to an event date may not leave enough time. Event cancellations and changes are not handled. Proposed default: a minimum hand-off window before the deadline, and users can mark an intent Withdrawn if an event is cancelled.

**G19. Legal and policy limits.** Resale price caps, ticket transfer restrictions, and sublet consent requirements vary. The platform does not enforce them. Proposed default: users are responsible, with disclaimers; consider a "face value only" option for tickets later. Not legal advice, and worth a real check before launch.

**G20. Per-user limits and spam.** Many intents from one user can crowd neighborhoods and inflate visibility. Proposed default: open-intent limit.

**G21. Payment structure.** One amount per flow does not capture rent per month, deposits, or refundable amounts. Payment methods are off-platform. Proposed default: single amounts only in v1; sublet rent and deposit as separate flows.

---

## 10. Out of scope for this spec
- Technology choices, hosting, data design, message formats.
- Agent-to-agent protocol details.
- Payments, escrow, and shipping.
- Automatic price changes and automatic approval.
- Cross-campus communities.
- A human-browsable marketplace view.
- Legal review.

## 11. Planned follow-up docs
1. Matching and search: how arrangements are found, graded, and ranked.
2. Agent protocol: notices, pre-checks, negotiation, replacement.
3. State and consistency: how approvals, revisions, and commit stay correct under concurrency.
4. Messaging: notification catalog turned into message flows and reply handling.
5. Trust and safety: reliability, reports, verification.
6. Integration: how users reach their agent (including the Fetch.ai interface).
7. Observability: what to trace and which alerts to set.
8. Demo and MVP scope: what to cut for 36 hours.