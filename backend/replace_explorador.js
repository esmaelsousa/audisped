const fs = require('fs');
let content = fs.readFileSync('../frontend/src/views/ExploradorView.vue', 'utf8');

content = content.replace("import { useRoute, useRouter } from 'vue-router'", "import { useRoute, useRouter } from 'vue-router'\nimport { FolderArchive, Search, Plus, Loader2, Trash2, ArrowRight, FolderOpen, ArrowLeft } from 'lucide-vue-next'");

content = content.replace("← VOLTAR PARA EMPRESAS", "<ArrowLeft class=\"w-3 h-3\" /> VOLTAR PARA EMPRESAS");
content = content.replace("🔍", "<Search class=\"w-4 h-4\" />");
content = content.replace("+ NOVA ANÁLISE", "<Plus class=\"w-4 h-4 inline mr-1\" /> NOVA ANÁLISE");
content = content.replace("<div class=\"animate-spin text-4xl mb-4\">⌛</div>", "<Loader2 class=\"w-10 h-10 animate-spin text-slate-300 mx-auto mb-4\" />");
content = content.replace("📁", "<FolderOpen class=\"w-5 h-5\" />");
content = content.replace("🗑️", "<Trash2 class=\"w-4 h-4\" />");
content = content.replace("→", "<ArrowRight class=\"w-4 h-4\" />");
content = content.replace("🏜️", "<FolderArchive class=\"w-12 h-12 text-slate-200 mx-auto\" />");

fs.writeFileSync('../frontend/src/views/ExploradorView.vue', content);
