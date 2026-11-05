// Keycloak wird direkt vom Browser aufgerufen, alle APIs laufen über das Gateway (gleiche Origin)
export const config = {
  apiBase: '/api',
  // Version der Showtime-API: '/showtimes' (v1) oder '/v2/showtimes' (v2)
  showtimesPath: '/showtimes',
  keycloak: {
    url: 'http://localhost:8080',
    realm: 'cinema',
    clientId: 'cinema-web',
  },
};
