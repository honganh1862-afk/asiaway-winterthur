# Floor guide — Asiaway menu

For the people working the floor. The phones show the menu; you take the order.
There is no staff app and nothing to sign in to.

## What the guest does

1. **Scans the card on the table.** It opens the menu with the table number
   already shown at the top.
2. **Chooses how to read the menu:** *Classic*, which turns pages like the
   printed menu, or *Modern*, one long list with photos. Both have the same
   dishes, in English, German or Vietnamese.
3. **Adds dishes to the cart.** The cart says plainly that nothing has been
   ordered yet and that a waiter will come.
4. **Shows you the cart.** Dish numbers are printed large: key those into the
   POS.
5. **Pays at the counter** when finished. Their phone shows the table number to
   give at the counter, and then invites them to review us on Google.

## Taking the order

- The guest's cart is a wish list, not an order. Nothing reaches the kitchen
  until you key it into the POS.
- If a dish is not available today, tell the guest; their phone does not know.
- Special requests are spoken, not typed: ask, and add them in the POS as usual.

## Paying

- **Winterthur:** at the counter in front of the stairs.
- **Oerlikon:** at the counter.

The guest gives their table number; find the bill in the POS by it.

## Table cards

Each table has a fold-over card with its QR code on both sides. Print new ones
with `npm run qr -- winterthur` or `npm run qr -- oerlikon` (see
[Deployment](DEPLOYMENT.md#table-cards)). Older cards with a different-looking
code still work.

## If something goes wrong

- **A card does not scan:** the guest can open the restaurant's address in the
  browser instead; the menu opens without the table number. Replace the card.
- **"This code is not active":** the card is from a table that no longer
  exists. Replace it with a new card.
- **The menu does not load:** check the internet connection on the phone, then
  `/api/health` on the site. Paper menus are the fallback, as the card says.

## The staff screen (Winterthur and Oerlikon)

Open `/staff` on the restaurant's address (for example
`https://asiaway-winterthur.vercel.app/staff`) and add it to the phone's home
screen. Tap your name and type the PIN; the sign-in lasts 12 hours.

- **Tables with orders** lists every table whose guests have put something in
  their cart, the most recently changed first. It updates every few seconds.
- Everyone at a table shares **one cart**: whatever any phone at the table adds,
  every phone there sees, and so do you.
- Tap a table to see its list, by dish number. Change a quantity with − and +,
  or remove a line. For a guest ordering from the printed menu, open their table
  (under **All tables**) and add the dish by number or name.
- Each table is served **in courses** (1. Gang, 2. Gang) or **all at once**: the
  guests choose at the top of their cart, and you can change it on the table's
  page. In courses, dishes start in the 1. Gang and move with one tap; drinks
  have no course. The board shows "2nd course: n" or "All at once" per table.
- **Which menu a table gets** (Winterthur) follows the day: Monday, Friday and
  Saturday Vietnamese only; Tuesday to Thursday 1xx Vietnamese, 2xx both, 3xx
  Thai; Sunday Thai only (`menuSchedule` in `src/config/restaurant.ts`). On a
  table's page, **Menu for this table** sets it to Vietnamese, Thai or both for
  those guests; only staff can, and clearing the table returns it to the plan.
- Take the order into the till as before: nothing here reaches the kitchen.
  Send the 1. Gang and drinks now and hold the 2. Gang; release it once the
  1. Gang is cleared (SOP-01).
- When the table has paid, tap **Paid — clear table**. The list empties on the
  guests' phones too, ready for the next guests.
- **Manage tables** adds a table, sets inside or outside, or removes one (a
  table with dishes on it must be cleared first). A removed table can be
  brought back and its printed card works again.

The staff lists are `staff` in `src/config/restaurant.ts`, one per restaurant
(Oerlikon: Belle); the PIN is each project's `STAFF_PIN` setting on Vercel.
A table added to `data/<restaurant>-tables.json` is in service after the next
deploy. A table card for a table the restaurant does not have still opens the
menu, with a cart on that phone only. After ten wrong PINs from one
phone, or thirty overall, within 15 minutes, sign-in pauses for a while.
