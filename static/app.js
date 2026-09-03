/* Come see — RSVP page. Plain JS, no dependencies, no external requests.
   All text from events.json and the API is rendered via textContent. */
(function () {
  'use strict';

  var STORAGE_KEY = 'come-see:name';
  var UID_DOMAIN = 'come-see.ethancloin.xyz';
  var TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  var GENERIC_ERROR = "Something went wrong. Please try again.";

  var state = { name: loadName() };
  var cards = {}; // id -> { event, listEl, countEl, form, input, errorEl, youEl }

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

  function loadName() {
    try { return (localStorage.getItem(STORAGE_KEY) || '').trim(); } catch (e) { return ''; }
  }
  function saveName(name) {
    try { localStorage.setItem(STORAGE_KEY, name); } catch (e) { /* private mode etc. */ }
  }

  function normalizeName(s) {
    return String(s).trim().replace(/\s+/g, ' ');
  }
  function sameName(a, b) {
    return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();
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
  var timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  var tzFmt = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' });

  function dayKey(d) {
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
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

  /* ---------- rendering ---------- */

  function renderList(card, names) {
    card.names = names;
    card.listEl.textContent = '';
    names.forEach(function (n) {
      var li = el('li', { text: n });
      if (state.name && sameName(n, state.name)) li.className = 'is-you';
      card.listEl.appendChild(li);
    });
    var count = names.length;
    card.countEl.textContent = count === 0 ? 'Nobody yet' : count + ' going';
    updateYouState(card);
  }

  function updateYouState(card) {
    var going = !!state.name && card.names.some(function (n) { return sameName(n, state.name); });
    card.youEl.hidden = !going;
    card.form.hidden = going;
    if (!going && !card.input.value) card.input.value = state.name;
  }

  function refreshList(card) {
    return fetchList(card.event.id).then(function (names) {
      renderList(card, names);
    }, function () {
      if (card.names.length === 0) card.countEl.textContent = "Couldn't load the list";
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
          var previous = state.name;
          state.name = name;
          saveName(name);
          card.input.value = name;
          // Prefill the other untouched forms with the new name.
          Object.keys(cards).forEach(function (id) {
            var c = cards[id];
            if (c !== card && (!c.input.value || sameName(c.input.value, previous))) c.input.value = name;
            if (c !== card) updateYouState(c);
          });
          return refreshList(card);
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

  function buildCard(ev, range) {
    var id = ev.id;
    var card = { event: ev, names: [] };
    cards[id] = card;

    var titleId = 'event-' + id + '-title';
    var inputId = 'rsvp-' + id + '-name';

    card.countEl = el('p', { class: 'rsvp-count', text: 'Loading…' });
    card.listEl = el('ul', { class: 'rsvp-list', 'aria-label': 'Who is going' });

    card.input = el('input', {
      type: 'text', id: inputId, name: 'display_name', maxlength: '40', required: '',
      autocomplete: 'name', placeholder: 'Your name', value: state.name
    });
    card.hp = el('input', {
      type: 'text', name: 'website', class: 'hp', tabindex: '-1',
      autocomplete: 'off', 'aria-hidden': 'true'
    });
    card.button = el('button', { type: 'submit', text: "I'm in" });
    card.errorEl = el('p', { class: 'form-error', role: 'status', 'aria-live': 'polite' });

    card.form = el('form', { class: 'rsvp-form', novalidate: '' }, [
      el('label', { for: inputId, text: 'Add your name' }),
      el('div', { class: 'rsvp-row' }, [card.input, card.button]),
      card.hp,
      card.errorEl
    ]);
    card.form.addEventListener('submit', function (e) { onSubmit(card, e); });

    card.youEl = el('p', { class: 'you-going', text: "You're going", hidden: '' });

    var icsBlob = new Blob([buildIcs(ev, range)], { type: 'text/calendar;charset=utf-8' });
    var icsLink = el('a', {
      class: 'ics-link', href: URL.createObjectURL(icsBlob), download: id + '.ics', text: 'Download .ics'
    });
    var gcalLink = el('a', {
      class: 'gcal-link', href: googleUrl(ev, range), target: '_blank', rel: 'noopener noreferrer',
      text: 'Add to Google Calendar'
    });

    var article = el('article', { class: 'event', id: 'event-' + id, 'aria-labelledby': titleId }, [
      el('h3', { class: 'event-title', id: titleId, text: ev.title || id }),
      el('p', { class: 'event-meta' }, [el('span', { class: 'event-time', text: timeRange(range) })]),
      ev.location ? el('p', { class: 'event-meta event-where', text: ev.location }) : null,
      ev.description ? el('p', { class: 'event-desc', text: ev.description }) : null,
      el('section', { class: 'rsvps', 'aria-label': 'RSVPs' }, [card.countEl, card.listEl]),
      card.youEl,
      card.form,
      el('p', { class: 'calendar' }, [icsLink, gcalLink])
    ]);

    return article;
  }

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
      status.textContent = 'No events yet. Check back soon.';
      return;
    }
    status.hidden = true;

    var currentKey = null, section = null;
    events.forEach(function (x) {
      var key = dayKey(x.range.start);
      if (key !== currentKey) {
        currentKey = key;
        section = el('section', { class: 'day' }, [
          el('h2', { class: 'day-heading', text: dayFmt.format(x.range.start) })
        ]);
        container.appendChild(section);
      }
      section.appendChild(buildCard(x.ev, x.range));
    });

    var note = document.getElementById('tz-note');
    var abbr = tzAbbrev(events[0].range.start);
    note.textContent = 'Times are shown in your local time zone' + (abbr ? ' (' + abbr + ')' : '') + '.';
    note.hidden = false;

    Object.keys(cards).forEach(function (id) { refreshList(cards[id]); });
  }

  function showLoadError() {
    var status = document.getElementById('status');
    status.textContent = "Couldn't load the events. Please refresh the page to try again.";
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
