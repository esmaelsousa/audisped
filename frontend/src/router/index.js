import { createRouter, createWebHistory } from 'vue-router'
import { token, usuario, precisaTrocarSenha } from '../store'

// Importação das Views
import EmpresasView from '../views/homeView.vue'
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
      path: '/injetor-cte',
      name: 'injetor-cte',
      component: () => import('../views/InjetorCteView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/analisador/:id?',
      name: 'analisador',
      component: AnalisadorView,
      meta: { requiresAuth: true }
    },
    {
      path: '/validador/:id?',
      name: 'validador',
      component: () => import('../views/ValidadorView.vue'),
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
    },
    {
      path: '/rentabilidade/:id',
      name: 'rentabilidade',
      component: () => import('../views/RentabilidadeView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/regras-fiscais',
      name: 'regras-fiscais',
      component: () => import('../views/RegrasFiscaisView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/catalogo-regras',
      name: 'catalogo-regras',
      component: () => import('../views/CatalogoView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/de-para',
      name: 'de-para-xml',
      component: () => import('../views/DeParaXmlView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/xml-tributacao/:id?',
      name: 'xml-tributacao',
      component: () => import('../views/XmlTributacaoView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/mde',
      name: 'mde',
      component: () => import('../views/MdeView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/perfil',
      name: 'perfil',
      component: () => import('../views/ProfileView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/cfops',
      name: 'cfops',
      component: () => import('../views/CfopView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/impressao-lmc',
      name: 'impressao-lmc',
      component: () => import('../views/ImpressaoLmcView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/usuarios',
      name: 'usuarios',
      component: () => import('../views/UsuariosView.vue'),
      meta: { requiresAuth: true, roles: ['super_admin', 'admin'] }
    },
    {
      path: '/trocar-senha',
      name: 'trocar-senha',
      component: () => import('../views/TrocarSenhaView.vue'),
      meta: { requiresAuth: true }
    }
  ]
})

// Guarda de Rota
router.beforeEach((to, from, next) => {
  // 1) exige login
  if (to.meta.requiresAuth && !token.value) {
    return next('/login');
  }
  // 2) troca de senha obrigatória: trava tudo até trocar (exceto a própria tela e o login)
  if (token.value && precisaTrocarSenha.value && to.path !== '/trocar-senha' && to.path !== '/login') {
    return next('/trocar-senha');
  }
  // 3) rotas por papel (default-deny se sessão antiga sem role)
  if (to.meta.roles && !to.meta.roles.includes(usuario.value?.role)) {
    return next('/');
  }
  next();
});

export default router