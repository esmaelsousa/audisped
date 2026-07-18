import { ref, computed } from 'vue'

// --- FUNÇÃO AUXILIAR PARA ACESSO SEGURO AO STORAGE (Navegador vs Node/Build) ---
const getStorageItem = (key, defaultValue = null) => {
    if (typeof localStorage !== 'undefined') {
        const item = localStorage.getItem(key);
        if (item === null) return defaultValue;
        try {
            return JSON.parse(item);
        } catch {
            return item;
        }
    }
    return defaultValue;
};

const setStorageItem = (key, value) => {
    if (typeof localStorage !== 'undefined') {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
};

const removeStorageItem = (key) => {
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
    }
};

// --- ESTADO GLOBAL (SESSÃO) ---
// Note: token é mantido como string simples, usuario como objeto
export const token = ref(typeof localStorage !== 'undefined' ? localStorage.getItem('token') || '' : '');
export const usuario = ref(getStorageItem('usuario'));
export const precisaTrocarSenha = ref(getStorageItem('precisaTrocarSenha') === true);

// --- PAYWALL (ambiente de demonstração) — modal de "contrate para baixar" ---
export const paywallVisivel = ref(false);
export function mostrarPaywall() { paywallVisivel.value = true; }
export function fecharPaywall() { paywallVisivel.value = false; }

// --- PAPÉIS (derivados de usuario.role; default-deny se sessão antiga sem role) ---
export const isSuper = computed(() => usuario.value?.role === 'super_admin');
export const podeGerenciarUsuarios = computed(() => ['super_admin', 'admin'].includes(usuario.value?.role));

// --- ESTADO DA AUDITORIA ---
export const arquivoInfo = ref(getStorageItem('arquivoInfo'));
export const empresaSelecionada = ref(getStorageItem('empresaSelecionada'));
export const idArquivoSped = ref(typeof localStorage !== 'undefined' ? localStorage.getItem('idArquivoSped') : null);
export const auditErros = ref([]);
export const auditResumoGerencial = ref(null);
export const auditResumoEstoque = ref([]);

// --- FUNÇÕES DE MUTAÇÃO ---
export function setArquivoInfo(info) {
    arquivoInfo.value = info;
    setStorageItem('arquivoInfo', info);
    if (info && info.id) {
        setIdArquivoSped(info.id);
    }
}

export function setIdArquivoSped(id) {
    idArquivoSped.value = id;
    if (id) {
        if (typeof localStorage !== 'undefined') localStorage.setItem('idArquivoSped', id);
    } else {
        if (typeof localStorage !== 'undefined') localStorage.removeItem('idArquivoSped');
    }
}

export function setEmpresaSelecionada(empresa) {
    empresaSelecionada.value = empresa;
    setStorageItem('empresaSelecionada', empresa);
}

export function setAuth(newToken, newUsuario) {
    token.value = newToken;
    usuario.value = newUsuario;
    setStorageItem('token', newToken);
    setStorageItem('usuario', newUsuario);
}

export function setUsuario(newUsuario) {
    usuario.value = newUsuario;
    setStorageItem('usuario', newUsuario);
}

export function setPrecisaTrocarSenha(v) {
    precisaTrocarSenha.value = v === true;
    setStorageItem('precisaTrocarSenha', v === true);
}

export function resetArquivoSped() {
    arquivoInfo.value = null;
    idArquivoSped.value = null;
    removeStorageItem('arquivoInfo');
    removeStorageItem('idArquivoSped');
    auditErros.value = [];
    auditResumoGerencial.value = null;
    auditResumoEstoque.value = [];
}

export function logout() {
    setAuth('', null);
    setPrecisaTrocarSenha(false);
    resetArquivoSped();
    setEmpresaSelecionada(null);
}