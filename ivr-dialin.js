// Phone dial-in for openDesk (Jitsi) meetings — JavaScript for a Vodia PBX IVR node.
//
// The caller enters the meeting PIN. The script asks openDesk's conference mapper for the room,
// then transfers the call to the room's name. The tenant's dial plan routes that name to the
// "Jigasi" trunk, whose custom header turns it into Jitsi-Conference-Room (see README.md).
//
// Counterpart of nordeck/jigasi-recepta (FreeSWITCH). Apache-2.0.

'use strict';

// ── Settings ────────────────────────────────────────────────────────────────
// openDesk's conference mapper; {pin} is replaced by the digits the caller entered.
var MAPPER_URL = 'https://CONFERENCE-MAPPER.example.org/conferenceMapper?id={pin}';
var PIN_MAX_LENGTH = 10;       // as jigasi-recepta
var PIN_TIMEOUT_MS = 20000;    // per attempt
var ALLOWED_ATTEMPTS = 3;
var TEXT = {
  ask: 'Willkommen. Bitte geben Sie die Konferenz-PIN ein und bestätigen Sie mit der Raute-Taste. ' +
       'Welcome. Please enter the conference PIN, followed by the hash key.',
  bad: 'Diese PIN ist nicht gültig. This PIN is not valid.',
  joining: 'Sie werden jetzt mit der Konferenz verbunden. Connecting you to the meeting.',
  bye: 'Auf Wiederhören. Goodbye.'
};

// ── State ───────────────────────────────────────────────────────────────────
var digits = '';
var attempt = 1;
var timer = null;
var busy = false;   // true while the mapper is being asked

function ask(text) {
  digits = '';
  call.say(text);
  restartTimer();
}

function restartTimer() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(function () { submit(); }, PIN_TIMEOUT_MS);
}

function fail() {
  attempt += 1;
  if (attempt > ALLOWED_ATTEMPTS) {
    call.say(TEXT.bye);
    setTimeout(function () { call.hangup(); }, 3000);
    return;
  }
  ask(TEXT.bad + ' ' + TEXT.ask);
}

// The mapper answers with the room's address, e.g. {"conference": "myroom@conference.example.org"}.
// Only the room's name is dialed; the trunk adds "@conference.<openDesk domain>" itself.
function roomName(conference) {
  if (typeof conference !== 'string') return '';
  var name = conference.split('@')[0];
  return /^[A-Za-z0-9._-]{1,128}$/.test(name) ? name : '';
}

function submit() {
  if (busy) return;
  if (timer) { clearTimeout(timer); timer = null; }
  var pin = digits;
  digits = '';
  if (!/^[0-9]{1,10}$/.test(pin)) { fail(); return; }
  busy = true;
  system.http({
    method: 'GET',
    url: MAPPER_URL.replace('{pin}', encodeURIComponent(pin)),
    header: [{ name: 'Accept', value: 'application/json' }],
    timeout: 5000,
    callback: function (code, response) {
      busy = false;
      var room = '';
      if (code == 200) {
        try { room = roomName(JSON.parse(String(response)).conference); } catch (e) { room = ''; }
      }
      if (!room) { call.log('dial-in: no room for this PIN (HTTP ' + code + ')'); fail(); return; }
      call.log('dial-in: PIN accepted, room ' + room);
      call.say(TEXT.joining);
      setTimeout(function () { call.transfer(room); }, 3000);
    }
  });
}

call.dtmf(function (digit) {
  if (busy) return;
  if (digit == '#') { submit(); return; }
  if (!/^[0-9]$/.test(digit)) return;
  digits += digit;
  restartTimer();
  if (digits.length >= PIN_MAX_LENGTH) submit();
});

ask(TEXT.ask);
