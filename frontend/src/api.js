// Detecta automaticamente o host correto para o backend de forma segura.
// O uso de 'typeof window' garante que o processo de build do Vite no servidor (Node.js) não quebre.
const getBackendHost = () => {
    if (typeof window !== 'undefined') {
        return window.location.hostname;
    }
    return 'localhost'; // Fallback para o build-time
};

const backendHost = getBackendHost();
export const API_BASE_URL = `http://${backendHost}:15435`;
