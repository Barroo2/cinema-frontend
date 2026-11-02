// Keycloak wird direkt vom Browser aufgerufen, alle APIs laufen über das Gateway (gleiche Origin)
export const config = {
  apiBase: '/api',
  keycloak: {
    url: 'http://localhost:8080',
    realm: 'cinema',
    clientId: 'cinema-web',
  },
};
