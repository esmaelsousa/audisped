import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import router from './router'
import axios from 'axios'
import { token, logout } from './store'

// Timeout global: evita que requisições pendentes travem a UI indefinidamente
axios.defaults.timeout = 30000;

// Interceptor do Axios para injetar o Token em cada requisição
// IMPORTANTE: Sempre sobrescreve qualquer header Authorization já presente no config,
// garantindo que headers obsoletos de componentes (Bearer vazio) nunca cheguem ao backend.
axios.interceptors.request.use(config => {
    if (token.value) {
        config.headers.Authorization = `Bearer ${token.value}`;
    } else {
        // Remove header obsoleto para evitar enviar "Bearer " vazio ao backend
        delete config.headers.Authorization;
    }
    return config;
}, error => {
    return Promise.reject(error);
});

// Interceptor do Axios para lidar com token expirado ou erros 401/403
axios.interceptors.response.use(
    response => response,
    error => {
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            // Evita redirecionar se já estiver na tela de login
            if (router.currentRoute.value.path !== '/login') {
                logout();
                router.push('/login');
            }
        }
        return Promise.reject(error);
    }
);

const app = createApp(App)
app.use(router)
app.mount('#app')