# Adding a customer to the SMS ordering system

Three manual steps. Everything else happens automatically.

Route 25252 and 25248 differ only in which spreadsheet gets Step 2 and 3, and in
the product column order.

---

## Step 1 — Customers tab (main "automated restaurant order" spreadsheet)

Add one row. The system reads columns **A through H** (`sheets.ts`, `getCustomers`).

| Col | Field | Required | Notes |
|-----|-------|----------|-------|
| A | Name | **Yes** | Row is skipped entirely if A or B is blank |
| B | Phone | **Yes** | Row is skipped entirely if A or B is blank |
| C | Default Product | No | For customers who reply with just a number. One product only |
| D | Route | **Yes** | `25252` or `25248`. Blank or wrong and the order never reaches the route sheet |
| E | Product Order | No | Comma-separated, e.g. `4-inch, toast`. Lets a reply like "4 and 3" map positionally |
| F | SMS Days | No | Overrides the route schedule. `0`=Sun, `1`=Mon … `6`=Sat |
| G | Product Map | No | Per-customer remap, e.g. `long:top_slice` |
| H | Prefix | No | Only when two locations share one phone number |

Leave C–H blank unless needed.

### Which days each route is texted

Defined in `sms.ts`, `buildOrderPromptMessage`:

| Route | Wed | Fri | Sat |
|-------|-----|-----|-----|
| 25252 | yes | yes | yes |
| 25248 | yes | **no text** | yes |

A customer on 25248 who needs Friday requires `3,5,6` in column F.

---

## Step 2 — Restaurant_Data tab (New25252 or New25248)

Put the customer's name in **column A** of the next empty row. Leave the rest blank;
the system fills column B (date) and the product columns.

**Route 25252** product columns:

```
C = SANDWICH   D = 4 INCH   E = TOAST   F = HOT DOGS   G = DINNER
H = TOP SLICE  I = HOAGIE   J = MARTY   K = PLAIN MARTY   L = SLIDER
```

**Route 25248** product columns:

```
C = SANDWICH   D = 4 INCH   E = TOAST   F = HOT DOGS   G = DINNER
H = TOP SLICE  I = HOAGIE   J = MARTY   K = PLAIN MARTY
L = 5 INCH     M = POTATO BREAD   N = SLIDER
```

### The name has to match Step 1

Matching ignores case and apostrophes, so `JOE'S BBQ` matches `Joes BBQ`.

If no row matches, the system **logs a warning and silently skips it**. The order
still reaches the Orders tab and the warehouse email — it just never appears on the
route sheet or the driver tabs. This is the easiest thing to get wrong, and nothing
about it is visible in the spreadsheet.

There is also a fallback that matches when either name *contains* the other. Avoid
short names that are substrings of an existing one: a row called `JNN` would collide
with `JNN Oxford`.

---

## Step 3 — Driver tabs (same route spreadsheet)

Add the customer to every driver tab (Driver_MonTues, Driver_ThuFri, Driver_Sat, and
Alt_Route_Order_ThuFri where present).

**Copy and paste a neighbouring customer's row rather than typing formulas.** Select
the full row of the customer directly above where yours goes, copy, and paste into the
new row. Google Sheets shifts the `Restaurant_Data!` references automatically, which is
exactly what you want.

The formulas look like:

```
=IFERROR(IF(Restaurant_Data!C13=0,"",Restaurant_Data!C13),"")
```

Copying keeps the row numbers correct without hand-editing, so the row can't end up
pointing at the wrong customer.

---

## What happens automatically — don't do these by hand

- **Delivery tab** — rebuilt each morning from the Customers tab, deduplicated by name
- **Daily Totals** — covers 25252 and 25248 already
- **Orders tab** — rows are appended as orders come in
- **Code** — no change needed unless the customer orders a product the system
  doesn't know yet

---

## Adding a product the system doesn't have

This is a code change, not a spreadsheet change. It touches:

- `config.ts` — the `products` list, and the `PRODUCTS` env var in Render, which must
  stay in the same order as the Orders tab columns (reads are positional)
- `orderParser.ts` — `PRODUCT_ALIASES` and the AI fallback prompt
- `sheets.ts` — `ABBREV_TO_PRODUCT`, plus the route column lists
- `deliveryTab.ts` — the delivery tab headers
- `orderSummary.ts` — the friendly name used in the warehouse email

Adding a column to the Orders tab without updating `PRODUCTS` in Render (or the other
way round) silently shifts every product. Do both together.
