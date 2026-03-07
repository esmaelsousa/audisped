// Detecta automaticamente o host correto para o backend.
// Se o frontend for acessado via rede (ex: 192.168.5.106), o backend
// também será chamado no mesmo IP. Funciona tanto em localhost quanto na rede.
const backendHost = window.location.hostname;
export const API_BASE_URL = `http://${backendHost}:15435`;
