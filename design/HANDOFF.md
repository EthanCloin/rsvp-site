# Come See — design spec for implementation

Final design: <https://claude.ai/code/artifact/90a32384-5613-4fd1-8b8e-954dec41d8bd>
(page "Come See": desktop artboard `Main.dc.html`, phone artboard `Mobile.dc.html`).
The `.dc.html` files in this directory are the source of truth for every pixel value below;
open them when a number here is ambiguous. `come-see.html` is generated — never edit it.

Implement in `static/` only: `index.html`, `style.css`, `app.js`, `events.json`. No build
step, no framework (see `CONTRACT.md`). Fonts are the one exception to "no external
requests" — see *Decisions* at the end.

## What the page is

A friend-facing list of a few events over a short stay. Each event shows a photo
(optional), the date as the dominant element, title, time and place, a one-line
description, an RSVP block (collapsible attendee list plus a name field), an **Add to
calendar** button, a **Google Calendar** link, and any optional links from the data (e.g.
**Tickets**). A strip of the whole stay's days sits under the header so the gaps are
visible. The upcoming event is marked *Next up*; past events fade.

The RSVP API and its behaviours in `CONTRACT.md` are unchanged; only their presentation
changes.

## Data (`static/events.json`)

Existing shape from `CONTRACT.md` plus three optional fields. Nothing new is required.

```json
{
  "title": "Ethan's week home",
  "intro": "I'm in town for a week. Here's where I'll be. Come to whatever you can.",
  "stay": { "from": "2026-10-10", "to": "2026-10-17" },
  "events": [
    {
      "id": "wed-trivia",
      "title": "Trivia night",
      "start": "2026-10-14T19:00:00-04:00",
      "location": "The usual bar",
      "address": "456 Oak Ave, Hometown, FL 32000",
      "description": "We will lose, but with dignity.",
      "image": "img/trivia.jpg",
      "links": [ { "label": "Tickets", "url": "https://example.com/tix" } ]
    }
  ]
}
```

- `stay` (optional): the day strip's range, inclusive, as local calendar dates. When
  absent, derive it: first event's day through last event's day (in the visitor's local
  zone). Cap the strip at 14 days; beyond that, hide it.
- `image` (optional): path relative to `static/`. Rendered `object-fit: cover`. If absent,
  the card has no photo block (see *Card without a photo*). Files go under
  `static/img/`; recommend ≤ 1600px wide JPEG/WebP.
- `links` (optional): `{label, url}` list, rendered in order in the links row, opened in a
  new tab with `rel="noopener noreferrer"` and the external-link icon. A label of
  `Tickets` (case-insensitive) is styled in sienna; every other link is green. Max 3.
- `end` optional as before (2 h assumed for calendar entries; the card shows start only).

## Tokens (`style.css` `:root`)

Replace the current warm-brown set. Light mode only — Ethan's site has no dark mode; set
`color-scheme: light` and drop the `prefers-color-scheme: dark` block.

| Variable | Hex | Source | Used for |
| --- | --- | --- | --- |
| `--bg` | `#EFEFE7` | parchment-light | page and card background |
| `--bg-2` | `#DEDDCE` | parchment | photo placeholder while loading, attendee pills |
| `--surface` | `#FAFAF5` | | text input background |
| `--text` | `#22321E` | sage-900 | body copy, times |
| `--muted` | `#44553F` | sage-800 | intro, place, footer, "Oct" in the date tab |
| `--green` | `#547543` | fern-800 | h1, kickers, card titles, card and tab borders, button bg, strip ticks, green links |
| `--green-line` | `#5E864B` | fern-700 | underline on green links |
| `--faint` | `#A2B59B` | sage-500 | quiet days in the strip (decorative only, never text that must be read) |
| `--rule` | `#C14E36` | sienna-700 | 2px rule under the header |
| `--accent` | `#B34830` | sienna-800 | Next-up date tab text and border, Next-up kicker, Tickets link, error text |
| `--accent-line` | `#D2573B` | sienna-600 | underline on Tickets |
| `--button-ink` | `#EFEFE7` | parchment-light | text on the green button |
| `--shadow` | `0 1px 2px rgba(34,50,30,.08), 0 6px 18px rgba(34,50,30,.10)` | | cards |
| `--shadow-tab` | `0 1px 2px rgba(34,50,30,.08), 0 4px 12px rgba(34,50,30,.10)` | | date tab |
| `--radius` | `6px` | | cards, tabs, button |
| `--focus` | `#B34830` | | focus rings (2px solid, offset 2px) |

Contrast on `#EFEFE7`: `--text` 11.7, `--muted` 6.8, `--green` 4.54 (AA; use at ≥ 15px
bold or ≥ 20px), `--accent` 4.68. `--faint` and the underline colours fail AA and are
decorative.

## Type

Domine (titles, numerals) + Mulish (everything else), the pairing ethancloin.xyz loads.
Fallbacks: `Georgia, 'Times New Roman', serif` / `system-ui, -apple-system, 'Segoe UI', sans-serif`.

| Element | Face | Size / line-height | Weight | Extras |
| --- | --- | --- | --- | --- |
| kicker "Come see" | Mulish | 13 / 1.5 (12 on phone) | 800 | uppercase, letter-spacing .16em, `--green` |
| h1 | Domine | 46 / 1.12 desktop, 32 phone → `clamp(2rem, 6vw, 2.875rem)` | 700 | letter-spacing -.01em, `--green` |
| intro | Mulish | 17 / 1.5 (16 phone) | 400 | `--muted`, `max-width: 56ch`, `text-wrap: pretty` |
| strip weekday | Mulish | 11 (10 phone) | 800 | uppercase, letter-spacing .14em (.1em phone) |
| strip day number | Domine | 20 (16 phone) / 1 | 700 event days, 400 others | |
| date tab weekday | Mulish | 11 | 800 | uppercase, .14em |
| date tab number | Domine | 40 (36 phone) / 1 | 700 | letter-spacing -.02em |
| date tab month | Mulish | 11 | 700 | uppercase, .14em, `--muted` |
| Next-up kicker | Mulish | 12 | 800 | uppercase, .12em, `--accent` |
| card title | Domine | 24 (22 phone) / 1.2 | 700 | `--green` |
| time | Mulish | 15.2 | 700 | `--text` |
| place, description | Mulish | 15.2 / 1.5 | 400 | place `--muted`; description `--text`, `text-wrap: pretty` |
| button, links, "N going" toggle, "I'm in" | Mulish | 15.2 | 700 | |
| attendee pills | Mulish | 14.4 | 400 | `--text` on `--bg-2` |
| name input | Mulish | 16 | 400 | 16px so iOS does not zoom on focus |
| footer | Mulish | 14.4 | 400 | `--muted`, centered |

## Layout

Body: `background: var(--bg)`, `color: var(--text)`, 17px/1.5 Mulish. Content column
`max-width: 1100px; margin-inline: auto; padding: 48px 40px 64px` desktop,
`24px 16px 48px` below 640px.

**Header** — centered column: kicker, h1 (10px gaps), intro. `padding-bottom: 22px`
(18 phone), `border-bottom: 2px solid var(--rule)`, `margin-bottom: 28px` (20 phone).

**Day strip** — `<nav aria-label="Days of the stay">`, `display: grid;
grid-template-columns: repeat(N, minmax(0, 1fr))`, N = days in the stay, `margin-bottom:
36px` (24 phone), `padding-inline: 12px` desktop only. Each cell is a centered column,
`padding-top: 6px` (5 phone), gap 4px (3 phone): weekday abbreviation over the day
number. Event day: `border-top: 3px solid var(--green)`, both texts `--green`, number
700. Quiet day: `border-top: 1px solid var(--faint)`, both texts `--faint`, number 400.
Give each cell an `aria-label` like "Saturday, October 10, event" / "Monday, October 12";
the strip is informational, not navigation, so no links. Below 360px, or when N > 8, drop
the weekday label and keep only the number.

**Cards grid** — `display: grid; gap: 28px` desktop (22 phone, single column).
Columns: 1 below 640px, 2 from 640 to 959px, 3 at ≥ 960px. `align-items: stretch` so
the button rows align across a row; the card body uses `margin-top: auto` on the actions
block. Order: sorted by `start` ascending (unchanged).

**Footer** — `margin-top: 40px` (28 phone), centered, the existing time-zone note.

## Card anatomy

`<article>`: `background: var(--bg); border: 1px solid var(--green); border-radius:
var(--radius); box-shadow: var(--shadow); display: flex; flex-direction: column;
min-width: 0`. Do **not** set `overflow: hidden` on the card (the tab's shadow must
paint); round the photo's top corners instead.

1. **Photo** — `height: 210px` desktop (180 phone), `object-fit: cover`,
   `border-bottom: 1px solid var(--green)`, `border-radius: 5px 5px 0 0`, `alt=""`
   (decorative; the title carries the meaning). Background `--bg-2` while loading.
2. **Body** — `padding: 0 20px 20px` (0 16px 18px phone), column, gap 6px.
3. **Date row** — `display: flex; align-items: flex-end; gap: 16px; margin-top: -34px`
   (-32 phone), so the tab overlaps the photo's bottom edge.
   - **Date tab** — 78px wide (72 phone), `padding: 9px 0 10px` (8/9 phone), centered
     column, `line-height: 1`, `background: var(--bg)`, `border: 1px solid var(--green)`,
     `border-radius: var(--radius)`, `box-shadow: var(--shadow-tab)`. Rows: weekday
     (`--green`), number (`margin-top: 4px`, `--green`), month (`margin-top: 6px`,
     `--muted`). Mark the three abbreviations `aria-hidden` and add a visually hidden
     `<time datetime="2026-10-10">Saturday, October 10</time>` for screen readers.
   - **Next-up kicker** — sits beside the tab, bottom-aligned, `margin-bottom: 6px`,
     `--accent`. Only on the next-up card.
4. **Title** `h2`, `margin-top: 10px` (8 phone).
5. **Time and place** — one `<p>`: `<time>` in `--text` 700, then a line break on
   desktop / ` · ` on phone, then the place in `--muted`. Time formatting as today
   (visitor's zone; `10:00 AM – 12:00 PM`; start only when `end` is absent).
6. **Description** `margin-top: 6px` (4 phone). Omit the element when empty.
7. **RSVP block** — `<section>`: `margin-top: 14px; padding-top: 12px; border-top: 1px
   dashed var(--faint)`, column, gap 10px. See *RSVP states* for what it contains.
8. **Actions** — `margin-top: auto; padding-top: 18px` (14 phone), column, gap 4px:
   - **Add to calendar** — full-width `<a download>` for the `.ics`: `min-height: 44px;
     padding: 0 16px; border-radius: var(--radius); background: var(--green); color:
     var(--button-ink); font-weight: 700`, calendar icon 18px before the label, gap 8px.
     Hover: background `#44553F`. Active: `#22321E`. Focus-visible: ring per `--focus`.
   - **Links row** — `display: flex; flex-wrap: wrap; gap: 18px; align-items: center`.
     Each link is `inline-flex`, `min-height: 44px` (hit target), 700, no underline on the
     anchor; the label `<span>` carries `border-bottom: 1px solid` and
     `padding-bottom: 1px`. First link is always **Google Calendar** (the template URL
     from `CONTRACT.md`) in `--green` / `--green-line`. Then `links[]` from the data:
     Tickets in `--accent` / `--accent-line`, others green. External links get the
     16px arrow-up-right icon after the label, gap 6px. Hover on any link: the underline
     thickens to 2px; colour unchanged (lighter greens fail contrast).

### RSVP states

The block is always present. Its contents depend on the list and on whether the visitor
has already added their name (stored name in `localStorage`, as today).

- **Toggle** — a `<button type="button" aria-expanded>` reading `N going`, 700, `--green`,
  `min-height: 32px`, no background or border, with a 16px chevron before the label
  (`M9 6l6 6-6 6` collapsed, `M6 9l6 6 6-6` expanded). It controls a `<ul>` of pills:
  `display: flex; flex-wrap: wrap; gap: 6px`; each `<li>` `background: var(--bg-2);
  color: var(--text); border-radius: 999px; padding: 3px 11px; overflow-wrap: anywhere`.
  The visitor's own pill gets `outline: 2px solid var(--green); outline-offset: -2px`.
  **Collapsed by default** on every card; remember the open/closed choice per card in
  `sessionStorage` so a re-render after submitting does not snap it shut.
- **Empty list** — no toggle; a `<p>` reading `Nobody yet`, 700, `--muted`,
  `min-height: 32px`.
- **Form** (visitor not yet on the list) — `<form>` `display: flex; gap: 8px`: text input
  (`flex: 1 1 auto; min-width: 0; min-height: 44px; padding: 0 12px; background:
  var(--surface); border: 1px solid var(--green); border-radius: var(--radius);
  color: var(--text)`, `placeholder="Your name"`, `maxlength="40"`, `autocomplete="name"`)
  and an outlined **I'm in** button (`min-height: 44px; padding: 0 14px; background:
  transparent; border: 1px solid var(--green); color: var(--green); border-radius:
  var(--radius)`). Hover: background `--bg-2`. Disabled while submitting: `opacity: .6;
  cursor: progress`. Keep the visually hidden `website` honeypot from `CONTRACT.md`.
  The visible label is the placeholder; give the input `aria-label="Your name"`.
- **You're going** (visitor on the list) — the form is replaced by a `<p>` with a 16px
  check icon (`M5 12l5 5L20 7`) and `You're going`, 700, `--green`, `min-height: 32px`.
- **Errors** — a `<p>` under the form, 15.2px, `--accent`, with the messages from
  `CONTRACT.md` (`That name is already on the list`, the server's message, `Slow down and
  try again in a minute`). `Couldn't load the list` replaces the toggle when the GET fails.

Why the calendar button is filled and **I'm in** is outlined: the RSVP row already has a
bordered input beside it, so a second filled green block there reads as two buttons.

**Card without a photo** — omit the photo block; the body gets `padding-top: 20px` and
the date row loses its negative margin. Everything else identical.

**Next-up card** — the tab's border, weekday and number use `--accent` instead of
`--green`; the kicker appears. Nothing else changes.

**Past card** — whole `<article>` at `opacity: .55`; the tab's weekday and number in
`--muted`; no kicker; button and links still work. Prefix the visually hidden date with
"Past:".

## Time behaviour (`app.js`)

Compute once at load with the visitor's clock, then re-evaluate on `visibilitychange`
so a tab left open overnight updates.

- An event is **past** when `now > (end ?? start + 2h)`.
- **Next up** is the first non-past event by `start`. Exactly one, or none when all are
  past (then no kicker anywhere).
- Kicker text: `Next up · today`, `Next up · tomorrow`, `Next up · in N days`
  (calendar-day difference in the visitor's zone), or `Happening now` while
  `start ≤ now ≤ end` (kicker still `--accent`). Use a middle dot `·`.
- Day strip: an event day is any day with at least one event. No "today" marker in
  the strip; the kicker carries that.
- The `.ics` and Google Calendar behaviour is unchanged from `CONTRACT.md`.

## Icons

Inline SVG, `stroke="currentColor" stroke-width="2" stroke-linecap="round"
stroke-linejoin="round" fill="none"`, `aria-hidden="true"`. Two only:

```html
<!-- calendar-plus, 18px -->
<svg width="18" height="18" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18M12 14v4M10 16h4"></path></svg>
<!-- external, 16px -->
<svg width="16" height="16" viewBox="0 0 24 24"><path d="M7 17L17 7M9 7h8v8"></path></svg>
```

No emoji anywhere.

## States

- **Loading**: header renders from the JSON as soon as it arrives; the cards area shows
  the existing `status` line in `--muted`.
- **Fetch failure**: status line in `--accent`: "Couldn't load the events. Refresh to try
  again."
- **No events**: status line in `--muted`: "Nothing on the calendar yet."
- **Reduced motion**: the only transition is the button background (120ms); keep the
  existing media query.

## Decisions

1. **Fonts.** `style.css` and `app.js` say "no external assets". The design uses Domine +
   Mulish from Google Fonts, exactly as ethancloin.xyz does. Chosen resolution:
   **self-host** — download Domine 700 and Mulish 400/700/800 as `woff2` into
   `static/fonts/`, declare them with `@font-face` (`font-display: swap`), and keep the
   no-external-requests rule intact. If Ethan would rather just link Google Fonts like
   the portfolio does, that is a one-line swap.
2. **RSVP** stays, restyled: collapsible attendee list, outlined "I'm in". Nothing
   outside `static/` changes.
3. **Sample data in the mockups.** "Tickets" on Trivia night and "in 5 days" are
   stand-ins to show those states. `events.json` today has no `links`, `image` or `stay`;
   add `stay` for the October week and leave the rest to Ethan.

## Also in this directory

`DirectionA–D.dc.html` are the four layout sketches (C was chosen and became Main).
`Palette.dc.html` is the swatch/type sheet from the earlier RSVP draft; its "app tokens"
are superseded by the table above. `Dark.dc.html` is from that draft too and is not on
the canvas. `canvas.json` lays the artboards out on three pages.
