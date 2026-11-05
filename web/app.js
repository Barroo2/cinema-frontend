import Keycloak from './vendor/keycloak.js';
import { config } from './config.js';

const POLL_INTERVAL_MS = 2000;
const SELECTION_KEY = 'cinema.selection';

const keycloak = new Keycloak(config.keycloak);

const state = {
  authReady: false,
  authFailed: false,
  showtimes: null,
  showtimesError: null,
  selected: null,
  chosenSeats: new Set(),
  seatError: null,
  bookingNotice: null,
  booking: false,
  bookings: [],
  bookingsError: null,
};

const el = {
  auth: document.getElementById('auth'),
  showtimes: document.getElementById('showtimes'),
  seats: document.getElementById('seats'),
  bookings: document.getElementById('bookings'),
};

// ---------- Hilfsfunktionen ----------

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'onclick') node.addEventListener('click', value);
    else if (key === 'disabled') node.disabled = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

const money = (value) => new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF' }).format(value);
// Tolerant Reader: v1 liefert den Preis als Zahl, v2 als { amount, currency }
const priceAmount = (price) => (typeof price === 'number' ? price : price.amount);
const dateTime = (value) => new Intl.DateTimeFormat('de-CH', {
  weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

const isLoggedIn = () => Boolean(keycloak.authenticated);
const email = () => keycloak.tokenParsed?.email;

class ApiError extends Error {
  constructor(status, message, correlationId) {
    super(message);
    this.status = status;
    this.correlationId = correlationId;
  }
}

async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) {
    try {
      await keycloak.updateToken(30);
    } catch {
      throw new ApiError(401, 'Die Anmeldung ist abgelaufen oder Keycloak ist nicht erreichbar. Bitte erneut anmelden.');
    }
    headers.Authorization = `Bearer ${keycloak.token}`;
  }

  let response;
  try {
    response = await fetch(`${config.apiBase}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Das Gateway ist nicht erreichbar.');
  }

  const correlationId = response.headers.get('X-Correlation-ID');
  const text = await response.text();
  if (!response.ok) throw new ApiError(response.status, errorMessage(response.status, text), correlationId);

  const data = text ? JSON.parse(text) : null;
  return { data, correlationId };
}

function errorMessage(status, text) {
  if ([502, 503, 504].includes(status)) return 'Der Service ist gerade nicht erreichbar. Bitte später nochmals versuchen.';
  if (status === 401 || status === 403) return 'Bitte melde dich erneut an.';
  if (status === 409) return 'Mindestens einer der Sitze ist bereits gebucht.';
  if (status === 404) return 'Die Vorstellung wurde nicht gefunden.';
  // booking-service liefert Validierungsfehler als kurzen Text
  return text && text.length < 200 && !text.startsWith('{') ? text : `Unerwarteter Fehler (${status}).`;
}

// ---------- Auth ----------

async function initAuth() {
  try {
    await keycloak.init({
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: `${location.origin}/silent-check-sso.html`,
      pkceMethod: 'S256',
      checkLoginIframe: false,
      messageReceiveTimeout: 4000,
    });
    state.authReady = true;
  } catch {
    // Vorstellungen sind öffentlich: ohne Keycloak bleibt die Seite nutzbar, nur Buchen geht nicht
    state.authFailed = true;
  }
  renderAuth();
  renderSeats();

  if (isLoggedIn()) await loadBookings();
  else renderBookings();
}

function login() {
  // Auswahl merken, damit sie den Redirect zu Keycloak übersteht
  if (state.selected) {
    sessionStorage.setItem(SELECTION_KEY, JSON.stringify({
      showtimeId: state.selected.id,
      seats: [...state.chosenSeats],
    }));
  }
  keycloak.login({ redirectUri: location.href });
}

function renderAuth() {
  if (state.authFailed) {
    el.auth.replaceChildren(h('span', { class: 'muted small' }, 'Login nicht verfügbar (Keycloak nicht erreichbar)'));
  } else if (!state.authReady) {
    el.auth.replaceChildren(h('span', { class: 'muted small' }, 'Login wird geprüft …'));
  } else if (isLoggedIn()) {
    el.auth.replaceChildren(
      h('span', { class: 'small' }, email() ?? keycloak.tokenParsed?.preferred_username ?? 'Angemeldet'),
      h('button', { onclick: () => keycloak.logout({ redirectUri: location.origin + '/' }) }, 'Abmelden'),
    );
  } else {
    el.auth.replaceChildren(h('button', { onclick: login }, 'Anmelden'));
  }
}

// ---------- Vorstellungen ----------

async function loadShowtimes() {
  state.showtimesError = null;
  try {
    const { data } = await api(config.showtimesPath);
    state.showtimes = data;
  } catch (error) {
    state.showtimes = null;
    state.showtimesError = error.message;
  }
  renderShowtimes();
}

function renderShowtimes() {
  if (state.showtimesError) {
    el.showtimes.replaceChildren(
      h('div', { class: 'notice error' }, state.showtimesError),
      h('button', { onclick: loadShowtimes }, 'Erneut laden'),
    );
    return;
  }
  if (!state.showtimes) {
    el.showtimes.replaceChildren(h('p', { class: 'muted' }, 'Lädt …'));
    return;
  }
  if (state.showtimes.length === 0) {
    el.showtimes.replaceChildren(h('p', { class: 'muted' }, 'Keine kommenden Vorstellungen.'));
    return;
  }
  el.showtimes.replaceChildren(...state.showtimes.map((showtime) => h('button', {
    class: `card${state.selected?.id === showtime.id ? ' selected' : ''}`,
    onclick: () => selectShowtime(showtime.id),
  },
  h('strong', {}, showtime.filmTitle),
  h('span', { class: 'muted small' }, `${dateTime(showtime.startsAtUtc)} · ${showtime.hallName}`),
  h('div', { class: 'small' }, money(priceAmount(showtime.price))))));
}

async function selectShowtime(id, seats = []) {
  state.seatError = null;
  state.bookingNotice = null;
  state.chosenSeats = new Set(seats);
  try {
    const { data } = await api(`${config.showtimesPath}/${id}`);
    state.selected = data;
  } catch (error) {
    state.selected = null;
    state.seatError = error.message;
  }
  renderShowtimes();
  renderSeats();
}

// ---------- Sitzplan ----------

// Die API kennt keinen Endpunkt für belegte Sitze: sie werden aus den Buchungen abgeleitet.
// Nur angemeldet verfügbar, sonst meldet das Buchen einen Konflikt (409).
function takenSeats() {
  if (!state.selected) return new Set();
  return new Set(state.bookings
    .filter((booking) => booking.showtimeId === state.selected.id && booking.status !== 'Cancelled')
    .flatMap((booking) => booking.seats.map((seat) => seat.toUpperCase())));
}

function toggleSeat(label) {
  if (state.chosenSeats.has(label)) state.chosenSeats.delete(label);
  else state.chosenSeats.add(label);
  state.bookingNotice = null;
  renderSeats();
}

function renderSeats() {
  const showtime = state.selected;
  if (!showtime) {
    el.seats.replaceChildren(state.seatError
      ? h('div', { class: 'notice error' }, state.seatError)
      : h('p', { class: 'muted' }, 'Wähle links eine Vorstellung.'));
    return;
  }

  const taken = takenSeats();
  for (const seat of state.chosenSeats) {
    if (taken.has(seat)) state.chosenSeats.delete(seat);
  }

  const rows = [];
  for (let i = 0; i < showtime.seatLabels.length; i += showtime.hall.seatsPerRow) {
    const labels = showtime.seatLabels.slice(i, i + showtime.hall.seatsPerRow);
    rows.push(h('div', { class: 'seat-row' },
      h('span', { class: 'row-label' }, labels[0][0]),
      ...labels.map((label) => {
        const isTaken = taken.has(label);
        const isChosen = state.chosenSeats.has(label);
        return h('button', {
          class: `seat${isTaken ? ' taken' : ''}${isChosen ? ' chosen' : ''}`,
          disabled: isTaken,
          'aria-pressed': String(isChosen),
          'aria-label': `Sitz ${label}${isTaken ? ' (belegt)' : ''}`,
          onclick: () => toggleSeat(label),
        }, label.slice(1));
      })));
  }

  const count = state.chosenSeats.size;
  const pricePerSeat = priceAmount(showtime.price);
  const total = count * pricePerSeat;
  let actionLabel = 'Sitze auswählen';
  if (count > 0) actionLabel = isLoggedIn() ? `${count} Sitz${count > 1 ? 'e' : ''} buchen` : 'Anmelden und buchen';

  el.seats.replaceChildren(
    h('p', {}, h('strong', {}, showtime.film.title)),
    h('p', { class: 'muted small' }, `${dateTime(showtime.startsAtUtc)} · ${showtime.hall.name} · ${money(pricePerSeat)} pro Sitz`),
    h('div', { class: 'screen' }, 'Leinwand'),
    h('div', { class: 'seat-scroll' }, ...rows),
    h('div', { class: 'summary' },
      state.seatError ? h('div', { class: 'notice error' }, state.seatError) : null,
      state.bookingNotice ? h('div', { class: 'notice' }, ...state.bookingNotice) : null,
      count > 0 ? h('p', {}, `Total: ${money(total)} (${[...state.chosenSeats].join(', ')})`) : null,
      h('button', {
        class: 'primary',
        disabled: count === 0 || state.booking || state.authFailed || !state.authReady,
        onclick: () => (isLoggedIn() ? createBooking() : login()),
      }, state.booking ? 'Wird gebucht …' : actionLabel)),
  );
}

// ---------- Buchungen ----------

async function createBooking() {
  state.booking = true;
  state.seatError = null;
  state.bookingNotice = null;
  renderSeats();

  try {
    // Nur IDs senden: Preis und gültige Sitze bestimmt der booking-service selbst
    const { data, correlationId } = await api('/bookings', {
      method: 'POST',
      auth: true,
      body: { showtimeId: state.selected.id, seats: [...state.chosenSeats] },
    });
    state.chosenSeats.clear();
    state.bookingNotice = [
      h('p', {}, `Buchung über ${money(data.totalPrice)} angenommen. Die Zahlung läuft, der Status wird rechts aktualisiert.`),
      correlationId ? h('p', { class: 'muted small mono' }, `Correlation-ID: ${correlationId}`) : null,
    ];
  } catch (error) {
    state.seatError = error.message;
    if (error.status === 401) keycloak.clearToken();
  }

  state.booking = false;
  await loadBookings();
  renderAuth();
  renderSeats();
}

async function cancelBooking(id) {
  try {
    await api(`/bookings/${id}`, { method: 'DELETE', auth: true });
    state.bookingsError = null;
  } catch (error) {
    state.bookingsError = error.message;
  }
  await loadBookings();
  renderSeats();
}

async function loadBookings() {
  if (!isLoggedIn()) return;
  try {
    const { data } = await api('/bookings', { auth: true });
    state.bookings = data;
    state.bookingsError = null;
  } catch (error) {
    state.bookingsError = error.message;
  }
  renderBookings();
  renderSeats();
}

function renderBookings() {
  if (state.authFailed) {
    el.bookings.replaceChildren(h('p', { class: 'muted' }, 'Ohne Login nicht verfügbar.'));
    return;
  }
  if (!isLoggedIn()) {
    el.bookings.replaceChildren(h('p', { class: 'muted' }, 'Melde dich an, um deine Buchungen zu sehen.'));
    return;
  }

  // Die API liefert alle Buchungen: hier nur die des angemeldeten Users anzeigen
  const mine = state.bookings.filter((booking) => booking.customerEmail === email());
  const nodes = mine.map(renderBooking);
  if (mine.length === 0) nodes.unshift(h('p', { class: 'muted' }, 'Noch keine Buchungen.'));
  if (state.bookingsError) nodes.unshift(h('div', { class: 'notice error' }, state.bookingsError));
  el.bookings.replaceChildren(...nodes);
}

const STATUS_LABELS = { Pending: 'Zahlung läuft', Confirmed: 'Bestätigt', Cancelled: 'Storniert' };

function renderBooking(booking) {
  const showtime = state.showtimes?.find((item) => item.id === booking.showtimeId);
  return h('div', { class: 'card' },
    h('div', { class: 'card-row' },
      h('strong', {}, showtime?.filmTitle ?? 'Vorstellung'),
      h('span', { class: `badge ${booking.status}` }, STATUS_LABELS[booking.status] ?? booking.status)),
    h('div', { class: 'muted small' }, `Sitze ${booking.seats.join(', ')} · ${money(booking.totalPrice)}`),
    showtime ? h('div', { class: 'muted small' }, dateTime(showtime.startsAtUtc)) : null,
    booking.status !== 'Cancelled'
      ? h('div', { class: 'booking-actions' }, h('button', { onclick: () => cancelBooking(booking.id) }, 'Stornieren'))
      : null);
}

// Solange eine Zahlung offen ist, den Status nachladen. Stoppt der payment-service,
// bleibt die Buchung auf "Zahlung läuft" und wechselt von selbst, sobald er wieder läuft.
function startPolling() {
  setInterval(() => {
    const hasPending = state.bookings.some((booking) => booking.status === 'Pending' && booking.customerEmail === email());
    if (isLoggedIn() && hasPending) loadBookings();
  }, POLL_INTERVAL_MS);
}

// ---------- Start ----------

async function start() {
  renderAuth();
  renderShowtimes();
  renderBookings();

  // Öffentliche Daten zuerst laden, damit die Seite auch ohne Keycloak funktioniert
  await loadShowtimes();
  await initAuth();
  renderBookings();

  const saved = sessionStorage.getItem(SELECTION_KEY);
  if (saved) {
    sessionStorage.removeItem(SELECTION_KEY);
    const { showtimeId, seats } = JSON.parse(saved);
    await selectShowtime(showtimeId, seats);
  }

  startPolling();
}

start();
