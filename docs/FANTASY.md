# CageMetrix fantasy: first playable slice

The fantasy UI is at `/fantasy` on the current Worker. Its API uses the existing community account session and lives under `/api/fantasy`. The site still canonicalizes `cagemetrix.com` to `mmascouts.com`, so the separate CageMetrix domain and account flow need deployment work before the consumer brand can launch independently.

## Rules in this slice

- Create a two to eight manager league in Premier or Challengers. Empty seats are filled with named bots. The creator drafts first.
- Four rounds use a snake draft; ownership of a fighter is exclusive within a league. Bot turns resolve immediately after the human turn and select eligible available fighters deterministically.
- Premier's initial pool is active UFC fighters with a completed UFC bout in the past three years. Challengers draws from the active global source snapshot, requiring a resolved fighter ID, two career bouts, a recent fight, and an active regional promotion in the curated registry. Insufficient pool size prevents league creation.
- Premier points per completed UFC fight: win 10, winning finish 8, knockdown 3, significant strike 0.1, takedown 2, control minute 1. Challengers: win 10; winning finish 8 or decision win 3; winning finish in round one 5, round two 3, later round 1. Draws and losses score zero. These are separate leaderboards, never comparable across tiers.
- Standings compute from verified rows dated on or after league creation. Historical fights do not award retrospective season points. MMA Scouts' Global Rating and recruiting data remain untouched.

## Next release gates

This is a solo league prototype, not a public launch: other humans cannot join, scoring has no frozen per-event ledger or results audit yet, and the current roster has four unrestricted slots per manager. Add invitations and joins, immutable scoring snapshots with source receipts and corrections, roster slots, waiver windows, trades, and a product-specific sign-in on `cagemetrix.com` before promoting it as the full fantasy product. Validate regional promotion coverage and source freshness before widening the Challengers pool. Dynasty remains a later cross-tier format.
