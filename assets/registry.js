// Registry page (/katalog/rejstrik/, /en/catalogue/registry/): filters and sorting over the list that
// tools/build.mjs renders statically. Without this script the full list still shows; the form stays hidden.
(function () {
  'use strict';
  var form = document.getElementById('reg-f'), list = document.getElementById('reg-l');
  if (!form || !list) return;
  var items = Array.prototype.slice.call(list.children);
  var countEl = document.getElementById('reg-count'), noneEl = document.getElementById('reg-none');
  var msg = form.getAttribute('data-msg') || '{n} / {total}';
  var fold = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  var num = function (el, k) { return +el.getAttribute('data-' + k) || 0; };
  var cmp = {
    fit: function (a, b) { return (num(b, 'maker') - num(a, 'maker')) || (num(b, 'school') - num(a, 'school')) || cmp.last(a, b); },
    school: function (a, b) { return (num(b, 'school') - num(a, 'school')) || (num(b, 'maker') - num(a, 'maker')) || cmp.last(a, b); },
    last: function (a, b) { return (b.getAttribute('data-last') || '').localeCompare(a.getAttribute('data-last') || '') || cmp.name(a, b); },
    name: function (a, b) { return (a.getAttribute('data-name') || '').localeCompare(b.getAttribute('data-name') || ''); }
  };
  // the static order is the "fit" order: keep it as the tie-breaker base
  items.forEach(function (el, i) { el._i = i; });
  // filters survive a reload / shared link through the query string
  var KEYS = ['q', 'cat', 'rights', 'printed', 'fit', 'sort'];
  try {
    var sp = new URLSearchParams(location.search);
    KEYS.forEach(function (k) {
      var v = sp.get(k), el = form.elements[k];
      if (v == null || !el) return;
      if (el.tagName === 'SELECT' && !Array.prototype.some.call(el.options, function (o) { return o.value === v; })) return;
      el.value = v;
    });
  } catch (e) {}

  function apply() {
    var f = form.elements, q = fold(f.q.value), cat = f.cat.value, rights = f.rights.value, printed = f.printed.value, fit = f.fit.value, sort = f.sort.value || 'fit';
    var words = q ? q.split(' ') : [], shown = 0;
    // "wheeled/rc-car" = a subcategory inside its category
    var catMain = cat.split('/')[0], catSub = cat.split('/')[1] || '';
    items.forEach(function (el) {
      var ok = (!cat || el.getAttribute('data-cat') === catMain && (!catSub || el.getAttribute('data-sub') === catSub)) && (!rights || el.getAttribute('data-rights') === rights)
        && (!printed || el.getAttribute('data-printed') === printed) && (!fit || num(el, fit) >= 4);
      if (ok && words.length) { var t = el.getAttribute('data-text') || ''; ok = words.every(function (w) { return t.indexOf(w) !== -1; }); }
      el.hidden = !ok;
      if (ok) shown++;
    });
    var sorted = items.slice().sort(function (a, b) { return cmp[sort] ? (cmp[sort](a, b) || a._i - b._i) : a._i - b._i; });
    sorted.forEach(function (el) { list.appendChild(el); });
    countEl.textContent = msg.replace('{n}', shown).replace('{total}', items.length);
    noneEl.hidden = shown > 0;
    try {
      var p = new URLSearchParams();
      KEYS.forEach(function (k) { var v = f[k].value; if (v && !(k === 'sort' && v === 'fit')) p.set(k, v); });
      var qs = p.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    } catch (e) {}
  }
  var t;
  form.addEventListener('input', function (e) { clearTimeout(t); t = setTimeout(apply, e.target.name === 'q' ? 120 : 0); });
  form.addEventListener('change', apply);
  form.addEventListener('reset', function () { setTimeout(apply, 0); });
  form.addEventListener('submit', function (e) { e.preventDefault(); apply(); });
  form.hidden = false;
  apply();
})();
