import { ref } from 'vue'

// --- ESTADO GLOBAL (SESSÃO) ---
export const token = ref(localStorage.getItem('token') || '');
export const usuario = ref(JSON.parse(localStorage.getItem('usuario') || 'null'));

// --- ESTADO DA AUDITORIA ---
export const arquivoInfo = ref(JSON.parse(localStorage.getItem('arquivoInfo') || 'null'));
export const empresaSelecionada = ref(JSON.parse(localStorage.getItem('empresaSelecionada') || 'null'));
export const idArquivoSped = ref(localStorage.getItem('idArquivoSped') || null);
export const auditErros = ref([]);
export const auditResumoGerencial = ref(null);
export const auditResumoEstoque = ref([]);

// --- FUNÇÕES DE MUTAÇÃO ---
export function setArquivoInfo(info) {
    arquivoInfo.value = info;
    if (info) localStorage.setItem('arquivoInfo', JSON.stringify(info));
    else localStorage.removeItem('arquivoInfo');
}

export function setEmpresaSelecionada(empresa) {
    empresaSelecionada.value = empresa;
    if (empresa) localStorage.setItem('empresaSelecionada', JSON.stringify(empresa));
    else localStorage.removeItem('empresaSelecionada');
}

export function setAuth(newToken, newUsuario) {
    token.value = newToken;
    usuario.value = newUsuario;
    if (newToken) {
        localStorage.setItem('token', newToken);
        localStorage.setItem('usuario', JSON.stringify(newUsuario));
    } else {
        localStorage.removeItem('token');
        localStorage.removeItem('usuario');
    }
}

export function resetArquivoSped() {
    arquivoInfo.value = null;
    idArquivoSped.value = null;
    localStorage.removeItem('arquivoInfo');
    localStorage.removeItem('idArquivoSped');
    auditErros.value = [];
    auditResumoGerencial.value = null;
    auditResumoEstoque.value = [];
}

export function logout() {
    setAuth('', null);
    resetArquivoSped();
    setEmpresaSelecionada(null);
}