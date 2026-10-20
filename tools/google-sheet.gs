/**
 * printedrobotics.cz — receives the site's forms and writes them to this Google Sheet.
 *
 * Setup (once):
 *  1. Open the sheet "printedrobotics.cz — předobjednávky" → Rozšíření / Extensions → Apps Script.
 *  2. Replace everything in Code.gs with this file and save.
 *  3. Run the function `test` once and allow the permissions (adds a test row, sends you an e-mail).
 *  4. Deploy → New deployment → type "Web app":
 *       Execute as: Me    ·    Who has access: Anyone
 *  5. Copy the Web app URL (https://script.google.com/macros/s/…/exec)
 *     into FORM_ENDPOINT in assets/config.js.
 * After editing this script later: Deploy → Manage deployments → edit → Version: New version
 * (the URL stays the same).
 */

const NOTIFY_BY_EMAIL = true;           // e-mail to the sheet owner on every new request
const TYPES = { preorder: 'Předobjednávka', notify: 'Upozornění', question: 'Dotaz' };

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    let d = {};
    try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out({ ok: false, error: 'bad-json' }); }
    if (d._gotcha) return out({ ok: true });                       // honeypot field filled → bot, ignore quietly
    const email = String(d.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return out({ ok: false, error: 'email' });

    const typ = TYPES[d.type] || 'Jiné';
    const row = [
      new Date(), typ, d.robot, d.configuration, d.setup, d.tier, d.color, d.material,
      d.qty, d.school, d.ico, email, d.note || d.question, d.source, d.page, 'Nová'
    ].map((v, i) => (i === 0 ? v : clean(v)));
    SpreadsheetApp.getActiveSpreadsheet().getSheets()[0].appendRow(row);

    if (NOTIFY_BY_EMAIL) {
      const me = Session.getEffectiveUser().getEmail();
      const body = [
        typ + ': ' + (d.robot || ''),
        d.configuration ? 'Konfigurace: ' + d.configuration : '',
        d.qty > 1 ? 'Počet sad: ' + d.qty + (d.ico ? ' · IČO ' + d.ico : '') : '',
        'E-mail: ' + email,
        (d.note || d.question) ? '\n' + (d.note || d.question) : '',
        '\n' + SpreadsheetApp.getActiveSpreadsheet().getUrl()
      ].filter(Boolean).join('\n');
      MailApp.sendEmail({ to: me, replyTo: email, subject: '[printedrobotics] ' + typ + ' · ' + (d.robot || '') + ' · ' + email, body: body });
    }
    return out({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// health check: opening the Web app URL in a browser shows {"ok":true}
function doGet() { return out({ ok: true, service: 'printedrobotics forms' }); }

// run once from the editor to grant permissions and see a sample row
function test() {
  doPost({ postData: { contents: JSON.stringify({ type: 'preorder', robot: 'TEST — smažte', configuration: 'Kompletní sada · Bílá · PLA+', tier: 'kit', color: 'white', material: 'pla', qty: 1, email: Session.getEffectiveUser().getEmail(), note: 'Testovací řádek', source: 'test', page: '' }) } });
}

// text only, max 1000 chars, and never let a cell start a formula (=, +, -, @)
function clean(v) {
  const s = String(v == null ? '' : v).slice(0, 1000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
