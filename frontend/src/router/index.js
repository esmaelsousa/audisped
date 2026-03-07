import { createRouter, createWebHistory } from 'vue-router'
import { token } from '../store'

// Importação das Views
import EmpresasView from '../views/HomeView.vue'
import ExploradorView from '../views/ExploradorView.vue'
import AnalisadorView from '../views/AnalisadorView.vue'
import LoginView from '../views/LoginView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView
    },
    {
      path: '/',
      name: 'home',
      component: EmpresasView, // Lista de Empresas
      meta: { requiresAuth: true }
    },
    {
      path: '/dashboard/:id',
      name: 'dashboard-cliente',
      component: () => import('../views/DashboardHubView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/injetor-xml',
      name: 'injetor-xml',
      component: () => import('../views/InjetorXmlView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/analisador/:id?',
      name: 'analisador',
      component: AnalisadorView,
      meta: { requiresAuth: true }
    },
    {
      path: '/empresa/:id',
      name: 'historico-empresa',
      component: ExploradorView, // Gestão de SPEDs Arquivos
      meta: { requiresAuth: true }
    },
    {
      path: '/lmc/:id',
      name: 'lmc',
      component: () => import('../views/LmcView.vue'),
      meta: { requiresAuth: true }
    }
  ]
})

// Guarda de Rota: Só permite acesso se houver token
router.beforeEach((to, from, next) => {
  if (to.meta.requiresAuth && !token.value) {
    next('/login');
  } else {
    next();
  }
});

export default router