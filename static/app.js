/* Come see — RSVP page. Plain JS, no dependencies, no external requests.
   All text from events.json and the API is rendered via textContent.
   Layout follows design/HANDOFF.md and the artboards beside it. */
(function () {
  'use strict';

  var STORAGE_KEY = 'come-see:name';
  var OPEN_KEY_PREFIX = 'come-see:open:';
  var MINE_KEY_PREFIX = 'come-see:mine:';
  var UID_DOMAIN = 'come-see.ethancloin.xyz';
  var TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  var MAX_STRIP_DAYS = 14;   // beyond this the strip stops being readable, so it hides
  var DENSE_STRIP_DAYS = 8;  // past this the weekday labels are dropped
  var MAX_DATA_LINKS = 3;
  var GENERIC_ERROR = "Something went wrong. Please try again.";

  var state = { name: loadName() };
  var cards = {};      // id -> card record
  var cardOrder = [];  // ids in start order, so "next up" is the first non-past

  /* ---------- helpers ---------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'class') node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Inline icon. Every icon in the design is a stroked 24-unit path set.
  function icon(size, paths) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    paths.forEach(function (spec) {
      var node = document.createElementNS(SVG_NS, spec.tag || 'path');
      Object.keys(spec).forEach(function (k) { if (k !== 'tag') node.setAttribute(k, spec[k]); });
      svg.appendChild(node);
    });
    return svg;
  }

  var ICON_CALENDAR = [
    { tag: 'rect', x: '3', y: '5', width: '18', height: '16', rx: '2' },
    { d: 'M16 3v4M8 3v4M3 10h18M12 14v4M10 16h4' }
  ];
  var ICON_EXTERNAL = [{ d: 'M7 17L17 7M9 7h8v8' }];
  var ICON_CHECK = [{ d: 'M5 12l5 5L20 7' }];
  var CHEVRON_COLLAPSED = 'M9 6l6 6-6 6';
  var CHEVRON_EXPANDED = 'M6 9l6 6 6-6';

  function loadName() {
    try { return (localStorage.getItem(STORAGE_KEY) || '').trim(); } catch (e) { return ''; }
  }
  function saveName(name) {
    try { localStorage.setItem(STORAGE_KEY, name); } catch (e) { /* private mode etc. */ }
  }
  // The RSVPs made from this browser: event id -> {id, token, name}. The token
  // comes back once, from the POST that created the row, and is the only thing
  // that lets us delete it again. Losing it (cleared storage, another browser)
  // costs nothing but the ability to self-remove.
  function loadMine(id) {
    try {
      var raw = localStorage.getItem(MINE_KEY_PREFIX + id);
      var rec = raw ? JSON.parse(raw) : null;
      if (!rec || typeof rec.token !== 'string' || typeof rec.name !== 'string') return null;
      if (typeof rec.id !== 'number') return null;
      return rec;
    } catch (e) {
      return null;
    }
  }
  function saveMine(id, rec) {
    try { localStorage.setItem(MINE_KEY_PREFIX + id, JSON.stringify(rec)); } catch (e) { /* private mode etc. */ }
  }
  function clearMine(id) {
    try { localStorage.removeItem(MINE_KEY_PREFIX + id); } catch (e) { /* ignore */ }
  }

  // Open/closed choice per card, so a re-render after submitting does not snap it shut.
  function loadOpen(id) {
    try { return sessionStorage.getItem(OPEN_KEY_PREFIX + id) === '1'; } catch (e) { return false; }
  }
  function saveOpen(id, open) {
    try { sessionStorage.setItem(OPEN_KEY_PREFIX + id, open ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function normalizeName(s) {
    return String(s).trim().replace(/\s+/g, ' ');
  }
  function sameName(a, b) {
    return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();
  }

  // events.json is ours, but keep javascript:/data: out of an href regardless.
  function safeUrl(u) {
    if (typeof u !== 'string' || !u) return null;
    try {
      var parsed = new URL(u, location.href);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : null;
    } catch (e) {
      return null;
    }
  }

  function parseDate(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  function eventRange(ev) {
    var start = parseDate(ev.start);
    if (!start) return null;
    var end = ev.end ? parseDate(ev.end) : null;
    if (!end || end <= start) end = new Date(start.getTime() + TWO_HOURS_MS);
    return { start: start, end: end };
  }

  // 2026-10-10T14:00:00.000Z -> 20261010T140000Z
  function utcStamp(d) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  var dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  var dowFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  var monFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
  var timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  var tzFmt = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' });

  /* ---------- local calendar days ---------- */

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }
  // Whole calendar days between two local midnights. DST-safe: round the ms gap.
  function dayDiff(from, to) {
    return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
  }
  function dayKey(d) {
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDay(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  // "2026-10-10" as a local calendar date, not the UTC midnight Date() would give us.
  function parseLocalDate(s) {
    var m = typeof s === 'string' && s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }

  function timeRange(range) {
    var sameDay = dayKey(range.start) === dayKey(range.end);
    if (typeof timeFmt.formatRange === 'function' && sameDay) {
      try { return timeFmt.formatRange(range.start, range.end); } catch (e) { /* fall through */ }
    }
    var endText = sameDay ? timeFmt.format(range.end) : dayFmt.format(range.end) + ', ' + timeFmt.format(range.end);
    return timeFmt.format(range.start) + ' – ' + endText;
  }
  function tzAbbrev(d) {
    try {
      var part = tzFmt.formatToParts(d).filter(function (p) { return p.type === 'timeZoneName'; })[0];
      if (part && part.value) return part.value;
    } catch (e) { /* ignore */ }
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  }

  /* ---------- calendar ---------- */

  function icsEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  // Fold a content line at 75 octets (RFC 5545 §3.1), never splitting a UTF-8 sequence.
  function foldLine(line) {
    var enc = new TextEncoder();
    var out = [];
    var cur = '';
    var curBytes = 0;
    var limit = 75;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      var cp = line.codePointAt(i);
      if (cp > 0xffff) { ch = line.slice(i, i + 2); i++; }
      var n = enc.encode(ch).length;
      if (curBytes + n > limit) {
        out.push(cur);
        cur = ' ';
        curBytes = 1;
      }
      cur += ch;
      curBytes += n;
    }
    out.push(cur);
    return out.join('\r\n');
  }

  function buildIcs(ev, range) {
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//come-see//' + UID_DOMAIN + '//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:' + ev.id + '@' + UID_DOMAIN,
      'DTSTAMP:' + utcStamp(new Date()),
      'DTSTART:' + utcStamp(range.start),
      'DTEND:' + utcStamp(range.end),
      'SUMMARY:' + icsEscape(ev.title),
      'LOCATION:' + icsEscape(ev.address || ev.location || ''),
      'DESCRIPTION:' + icsEscape(ev.description || ''),
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  function googleUrl(ev, range) {
    var params = [
      ['action', 'TEMPLATE'],
      ['text', ev.title || ''],
      ['details', ev.description || ''],
      ['location', ev.address || ev.location || '']
    ].map(function (p) { return p[0] + '=' + encodeURIComponent(p[1]); });
    // dates keeps its literal "/" separator; the stamps contain only [0-9TZ].
    params.splice(2, 0, 'dates=' + encodeURIComponent(utcStamp(range.start)) + '/' + encodeURIComponent(utcStamp(range.end)));
    return 'https://calendar.google.com/calendar/render?' + params.join('&');
  }

  /* ---------- API ---------- */

  function rsvpUrl(id) {
    return 'api/events/' + encodeURIComponent(id) + '/rsvps';
  }

  function fetchList(id) {
    return fetch(rsvpUrl(id), { headers: { 'Accept': 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var list = Array.isArray(data && data.rsvps) ? data.rsvps : [];
        return list.map(function (r) { return r && typeof r.display_name === 'string' ? r.display_name : ''; })
          .filter(Boolean);
      });
  }

  function postRsvp(id, name, website) {
    return fetch(rsvpUrl(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ display_name: name, website: website })
    });
  }

  function deleteRsvp(id, mine) {
    return fetch(rsvpUrl(id) + '/' + encodeURIComponent(mine.id), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ token: mine.token })
    });
  }

  function errorMessageFor(res) {
    if (res.status === 429) return Promise.resolve("Slow down and try again in a minute");
    if (res.status === 409 || res.status === 400) {
      return res.json().then(function (body) {
        if (res.status === 409 && (!body || body.error !== 'event_full')) {
          return "That name is already on the list";
        }
        return body && typeof body.message === 'string' && body.message ? body.message : GENERIC_ERROR;
      }, function () {
        return res.status === 409 ? "That name is already on the list" : GENERIC_ERROR;
      });
    }
    return Promise.resolve(GENERIC_ERROR);
  }

  /* ---------- RSVP block ---------- */

  function setExpanded(card, open) {
    card.open = open;
    card.toggleEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    card.chevron.setAttribute('d', open ? CHEVRON_EXPANDED : CHEVRON_COLLAPSED);
    card.listEl.hidden = !open;
  }

  function renderList(card, names) {
    card.names = names;
    card.loaded = true;
    card.listEl.textContent = '';
    names.forEach(function (n) {
      var li = el('li', { text: n });
      if (state.name && sameName(n, state.name)) li.className = 'is-you';
      card.listEl.appendChild(li);
    });

    var count = names.length;
    if (count === 0) {
      // No toggle to press: the same slot just says so.
      card.emptyEl.textContent = 'Nobody yet';
      card.emptyEl.hidden = false;
      card.toggleEl.hidden = true;
      card.listEl.hidden = true;
    } else {
      card.emptyEl.hidden = true;
      card.toggleEl.hidden = false;
      card.countText.nodeValue = count + ' going';
      setExpanded(card, card.open);
    }
    updateYouState(card);
  }

  function updateYouState(card) {
    var mine = loadMine(card.event.id);
    // The row can go away without us: removed on the box, or a restored backup.
    // Once the list says so, the token is dead weight - drop it.
    if (mine && card.loaded && !card.names.some(function (n) { return sameName(n, mine.name); })) {
      clearMine(card.event.id);
      mine = null;
    }
    var going = !!mine || (!!state.name && card.names.some(function (n) { return sameName(n, state.name); }));
    card.youEl.hidden = !going;
    card.form.hidden = going;
    // Only an RSVP this browser made can be taken back: that is the one we hold
    // a token for. Someone else's matching name is not ours to remove.
    card.removeBtn.hidden = !mine;
  }

  function refreshList(card) {
    return fetchList(card.event.id).then(function (names) {
      renderList(card, names);
    }, function () {
      if (card.names.length === 0) {
        card.emptyEl.textContent = "Couldn't load the list";
        card.emptyEl.hidden = false;
        card.toggleEl.hidden = true;
        card.listEl.hidden = true;
      }
    });
  }

  function setError(card, msg) {
    card.errorEl.textContent = msg || '';
  }

  function onSubmit(card, e) {
    e.preventDefault();
    var name = normalizeName(card.input.value);
    if (!name) { setError(card, 'Please enter a name.'); card.input.focus(); return; }
    setError(card, '');
    card.button.disabled = true;

    postRsvp(card.event.id, name, card.hp.value || '')
      .then(function (res) {
        if (res.ok) {
          state.name = name;
          saveName(name);
          card.input.value = name;
          // Keep the delete token for this event. Each card is typed into on its
          // own; a name entered here is never copied into another card's form.
          return res.json().then(function (body) {
            if (body && typeof body.token === 'string' && typeof body.rsvp_id === 'number') {
              saveMine(card.event.id, { id: body.rsvp_id, token: body.token, name: name });
            }
          }, function () { /* stored anyway; we just cannot delete it from here */ })
            .then(function () {
              Object.keys(cards).forEach(function (id) {
                if (cards[id] !== card) updateYouState(cards[id]);
              });
              return refreshList(card);
            });
        }
        return errorMessageFor(res).then(function (msg) {
          setError(card, msg);
          if (res.status === 409) return refreshList(card);
        });
      })
      .catch(function () {
        setError(card, GENERIC_ERROR);
      })
      .then(function () {
        card.button.disabled = false;
      });
  }

  function onRemove(card) {
    var mine = loadMine(card.event.id);
    if (!mine) { updateYouState(card); return; }
    setError(card, '');
    card.removeBtn.disabled = true;

    deleteRsvp(card.event.id, mine)
      .then(function (res) {
        // 404 means it is already gone, which is what was wanted. 403 means this
        // token no longer opens that row, so keeping it only shows a dead button.
        if (res.ok || res.status === 404 || res.status === 403) {
          clearMine(card.event.id);
          if (res.status === 403) setError(card, "That name can't be removed from this browser. Ask the host to take it off.");
          // Leave the name in this card's own box, so changing their mind back is one tap.
          card.input.value = mine.name;
          return refreshList(card);
        }
        return errorMessageFor(res).then(function (msg) { setError(card, msg); });
      })
      .catch(function () {
        setError(card, GENERIC_ERROR);
      })
      .then(function () {
        card.removeBtn.disabled = false;
      });
  }

  /* ---------- card ---------- */

  function buildLinks(ev, range) {
    var row = el('div', { class: 'event-links' });

    // Google Calendar always leads. It is external too, but the design gives the
    // arrow only to the links that come out of the data.
    row.appendChild(el('a', {
      class: 'gcal-link', href: googleUrl(ev, range), target: '_blank', rel: 'noopener noreferrer'
    }, [el('span', { text: 'Google Calendar' })]));

    // CONTRACT.md's shape (tickets_url / url), then HANDOFF.md's optional links[].
    var wanted = [];
    if (safeUrl(ev.tickets_url)) wanted.push({ label: 'Get tickets', url: safeUrl(ev.tickets_url), cls: 'ticket-link' });
    if (safeUrl(ev.url)) wanted.push({ label: 'Event page', url: safeUrl(ev.url), cls: 'event-link' });
    (Array.isArray(ev.links) ? ev.links : []).forEach(function (l) {
      var href = l && safeUrl(l.url);
      var label = l && typeof l.label === 'string' ? l.label.trim() : '';
      if (!href || !label) return;
      wanted.push({ label: label, url: href, cls: /^tickets$/i.test(label) ? 'ticket-link' : 'event-link' });
    });

    wanted.slice(0, MAX_DATA_LINKS).forEach(function (l) {
      row.appendChild(el('a', {
        class: l.cls, href: l.url, target: '_blank', rel: 'noopener noreferrer'
      }, [el('span', { text: l.label }), icon(16, ICON_EXTERNAL)]));
    });
    return row;
  }

  function buildCard(ev, range) {
    var id = ev.id;
    var card = { event: ev, range: range, names: [], loaded: false, open: loadOpen(id) };
    cards[id] = card;

    var titleId = 'event-' + id + '-title';
    var inputId = 'rsvp-' + id + '-name';

    /* photo */
    var photo = null;
    var imageSrc = ev.image && typeof ev.image === 'string' ? ev.image : '';
    if (imageSrc && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(imageSrc)) { // repo-relative paths only
      var img = el('img', {
        src: imageSrc,
        alt: typeof ev.image_alt === 'string' ? ev.image_alt : '',
        decoding: 'async'
      });
      photo = el('figure', { class: 'event-photo' }, [img]);
    }

    /* date tab */
    card.tabDow = el('span', { class: 'tab-dow', 'aria-hidden': 'true', text: dowFmt.format(range.start) });
    card.tabNum = el('span', { class: 'tab-num', 'aria-hidden': 'true', text: String(range.start.getDate()) });
    card.fullDate = dayFmt.format(range.start);
    card.timeEl = el('time', { class: 'vh', datetime: isoDay(range.start), text: card.fullDate });
    card.kickerEl = el('p', { class: 'next-kicker', hidden: '' });

    var dateRow = el('div', { class: 'date-row' }, [
      el('div', { class: 'date-tab' }, [
        card.tabDow,
        card.tabNum,
        el('span', { class: 'tab-mon', 'aria-hidden': 'true', text: monFmt.format(range.start) }),
        card.timeEl
      ]),
      card.kickerEl
    ]);

    /* time and place */
    var meta = el('p', { class: 'event-meta' }, [el('span', { class: 'event-time', text: timeRange(range) })]);
    if (ev.location) {
      meta.appendChild(el('br'));
      meta.appendChild(el('span', { class: 'event-where', text: ev.location }));
    }

    /* RSVP block */
    card.chevron = document.createElementNS(SVG_NS, 'path');
    card.chevron.setAttribute('d', CHEVRON_COLLAPSED);
    var chevronSvg = icon(16, []);
    chevronSvg.appendChild(card.chevron);

    card.countText = document.createTextNode('0 going');
    card.toggleEl = el('button', { type: 'button', class: 'rsvp-toggle', 'aria-expanded': 'false', hidden: '' });
    card.toggleEl.appendChild(chevronSvg);
    card.toggleEl.appendChild(card.countText);
    card.toggleEl.addEventListener('click', function () {
      setExpanded(card, !card.open);
      saveOpen(id, card.open);
    });

    card.emptyEl = el('p', { class: 'rsvp-count', text: 'Loading…' });
    card.listEl = el('ul', { class: 'rsvp-list', 'aria-label': 'Who is going', hidden: '' });
    card.toggleEl.setAttribute('aria-controls', 'rsvp-' + id + '-list');
    card.listEl.id = 'rsvp-' + id + '-list';

    card.input = el('input', {
      type: 'text', id: inputId, name: 'display_name', maxlength: '40', required: '',
      autocomplete: 'name', placeholder: 'Your name', 'aria-label': 'Your name'
    });
    card.hp = el('input', {
      type: 'text', name: 'website', class: 'hp', tabindex: '-1',
      autocomplete: 'off', 'aria-hidden': 'true'
    });
    card.button = el('button', { type: 'submit', text: "I'm in" });
    card.errorEl = el('p', { class: 'form-error', role: 'status', 'aria-live': 'polite' });

    card.form = el('form', { class: 'rsvp-form', novalidate: '' }, [card.input, card.hp, card.button]);
    card.form.addEventListener('submit', function (e) { onSubmit(card, e); });

    card.removeBtn = el('button', {
      type: 'button', class: 'remove-btn', hidden: '', text: 'Take my name off',
      'aria-label': 'Take my name off ' + (ev.title || id)
    });
    card.removeBtn.addEventListener('click', function () { onRemove(card); });

    card.youEl = el('p', { class: 'you-going', hidden: '' }, [
      icon(16, ICON_CHECK), document.createTextNode("You're going"), card.removeBtn
    ]);

    var rsvps = el('section', { class: 'rsvps', 'aria-label': 'RSVPs' }, [
      card.toggleEl, card.emptyEl, card.listEl, card.form, card.youEl, card.errorEl
    ]);

    /* actions */
    var icsBlob = new Blob([buildIcs(ev, range)], { type: 'text/calendar;charset=utf-8' });
    var icsLink = el('a', { class: 'ics-link', href: URL.createObjectURL(icsBlob), download: id + '.ics' }, [
      icon(18, ICON_CALENDAR), document.createTextNode('Add to calendar')
    ]);

    var article = el('article', {
      class: 'event' + (photo ? '' : ' no-photo'), id: 'event-' + id, 'aria-labelledby': titleId
    }, [
      photo,
      el('div', { class: 'event-body' }, [
        dateRow,
        el('h2', { class: 'event-title', id: titleId, text: ev.title || id }),
        meta,
        ev.description ? el('p', { class: 'event-desc', text: ev.description }) : null,
        rsvps,
        el('div', { class: 'actions' }, [icsLink, buildLinks(ev, range)])
      ])
    ]);

    card.article = article;
    return article;
  }

  /* ---------- time state: next up / past ---------- */

  function kickerText(card, now) {
    if (now >= card.range.start && now <= card.range.end) return 'Happening now';
    var days = dayDiff(now, card.range.start);
    if (days <= 0) return 'Next up · today';
    if (days === 1) return 'Next up · tomorrow';
    return 'Next up · in ' + days + ' days';
  }

  // Recomputed on load and whenever the tab comes back, so a page left open
  // overnight does not keep calling yesterday's event "next up".
  function applyTimeState() {
    var now = new Date();
    var nextId = null;
    cardOrder.forEach(function (id) {
      if (nextId === null && now <= cards[id].range.end) nextId = id;
    });

    cardOrder.forEach(function (id) {
      var card = cards[id];
      var past = now > card.range.end;
      var isNext = id === nextId;
      card.article.classList.toggle('is-past', past);
      card.article.classList.toggle('is-next', isNext);
      card.timeEl.textContent = (past ? 'Past: ' : '') + card.fullDate;
      if (isNext) {
        card.kickerEl.textContent = kickerText(card, now);
        card.kickerEl.hidden = false;
      } else {
        card.kickerEl.textContent = '';
        card.kickerEl.hidden = true;
      }
    });
  }

  /* ---------- day strip ---------- */

  function stripRange(data, events) {
    var stay = data && data.stay;
    var from = stay && parseLocalDate(stay.from);
    var to = stay && parseLocalDate(stay.to);
    if (!from || !to || to < from) {
      from = startOfDay(events[0].range.start);
      to = startOfDay(events[events.length - 1].range.start);
    }
    return { from: from, to: to, days: dayDiff(from, to) + 1 };
  }

  function renderStrip(data, events) {
    var strip = document.getElementById('day-strip');
    strip.textContent = '';

    var span = stripRange(data, events);
    if (span.days < 1 || span.days > MAX_STRIP_DAYS) { strip.hidden = true; return; }

    var eventDays = {};
    events.forEach(function (x) { eventDays[dayKey(x.range.start)] = true; });

    for (var i = 0; i < span.days; i++) {
      var day = addDays(span.from, i);
      var hasEvent = !!eventDays[dayKey(day)];
      // The abbreviations are decorative; the visually hidden label is what gets read.
      strip.appendChild(el('div', { class: 'day-cell' + (hasEvent ? ' has-event' : '') }, [
        el('span', { class: 'day-dow', 'aria-hidden': 'true', text: dowFmt.format(day) }),
        el('span', { class: 'day-num', 'aria-hidden': 'true', text: String(day.getDate()) }),
        el('span', { class: 'vh', text: dayFmt.format(day) + (hasEvent ? ', event' : '') })
      ]));
    }

    strip.style.setProperty('--days', String(span.days));
    strip.classList.toggle('is-dense', span.days > DENSE_STRIP_DAYS);
    strip.hidden = false;
  }

  /* ---------- page ---------- */

  function render(data) {
    var title = data && typeof data.title === 'string' && data.title ? data.title : 'Come see';
    document.title = title;
    document.getElementById('page-title').textContent = title;
    document.getElementById('page-intro').textContent = data && typeof data.intro === 'string' ? data.intro : '';

    var events = (data && Array.isArray(data.events) ? data.events : [])
      .map(function (ev) { return { ev: ev, range: ev && ev.id ? eventRange(ev) : null }; })
      .filter(function (x) { return x.range; })
      .sort(function (a, b) { return a.range.start - b.range.start; });

    var container = document.getElementById('events');
    var status = document.getElementById('status');
    container.textContent = '';

    if (events.length === 0) {
      status.textContent = 'Nothing on the calendar yet.';
      return;
    }
    status.hidden = true;

    renderStrip(data, events);

    events.forEach(function (x) {
      cardOrder.push(x.ev.id);
      container.appendChild(buildCard(x.ev, x.range));
    });
    applyTimeState();

    var note = document.getElementById('tz-note');
    var abbr = tzAbbrev(events[0].range.start);
    note.textContent = 'Times are shown in your local time zone' + (abbr ? ' (' + abbr + ')' : '') + '.';
    note.hidden = false;

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) applyTimeState();
    });

    cardOrder.forEach(function (id) { refreshList(cards[id]); });
  }

  function showLoadError() {
    var status = document.getElementById('status');
    status.textContent = "Couldn't load the events. Refresh to try again.";
    status.className = 'status error';
    status.hidden = false;
  }

  // no-cache = always revalidate, so an edited events.json shows up on the next load
  fetch('events.json', { cache: 'no-cache', headers: { 'Accept': 'application/json' } })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(render)
    .catch(function () { showLoadError(); });
})();
