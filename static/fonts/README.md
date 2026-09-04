# Fonts

Self-hosted so the page makes no external requests (see `CONTRACT.md`). Both
families are the pairing ethancloin.xyz uses, pulled from Google Fonts and kept
here as `woff2`:

| File | Family | Notes |
| --- | --- | --- |
| `domine-700-latin.woff2`, `domine-700-latin-ext.woff2` | Domine 700 | titles and numerals |
| `mulish-var-latin.woff2`, `mulish-var-latin-ext.woff2` | Mulish 400–800 | variable; one file covers 400, 700 and 800 |

Both are licensed under the SIL Open Font License 1.1:

- Domine — <https://fonts.google.com/specimen/Domine/about>
- Mulish — <https://fonts.google.com/specimen/Mulish/about>

The `@font-face` rules and their `unicode-range` subsets are at the top of
`../style.css`, copied from the Google Fonts CSS the files came from. To
refresh, re-download the `latin` and `latin-ext` `woff2` URLs listed by
`https://fonts.googleapis.com/css2?family=Domine:wght@700&family=Mulish:wght@400;700;800&display=swap`
and keep the ranges in sync.
