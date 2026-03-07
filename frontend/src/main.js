import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import router from './router'
import axios from 'axios'
import { token, logout } from './store'

// Interceptor do Axios para injetar o Token em cada requisição
axios.interceptors.request.use(config => {
    if (token.value) {
        config.headers.Authorization = `Bearer ${token.value}`;
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
            logout();
            router.push('/login');
        }
        return Promise.reject(error);
    }
);

const app = createApp(App)
app.use(router)
app.mount('#app')