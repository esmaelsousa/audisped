const fs = require('fs');
let content = fs.readFileSync('../frontend/src/views/AnalisadorView.vue', 'utf8');

// Replace standard emojis with lucide icons
content = content.replace("import { useRoute } from 'vue-router'", "import { useRoute } from 'vue-router'\nimport { Download, FileSpreadsheet, Settings, FileText, UploadCloud, Activity, AlertTriangle, AlertCircle, TrendingDown, DollarSign, CheckCircle2 } from 'lucide-vue-next'");

content = content.replace("📥 DOSSIÊ PDF", "<Download class=\"w-4 h-4\" /> DOSSIÊ PDF");
content = content.replace("📊 EXCEL (.XLSX)", "<FileSpreadsheet class=\"w-4 h-4\" /> EXCEL (.XLSX)");
content = content.replace("🛠️ EXPORTAR SPED", "<Settings class=\"w-4 h-4\" /> EXPORTAR SPED");
content = content.replace("📄", "<FileText class=\"w-5 h-5\" />");
content = content.replace("📂 Upload de Arquivo", "<UploadCloud class=\"w-4 h-4 mr-2 inline\" /> Upload de Arquivo");
content = content.replace("📊 Dashboard Analítico", "<Activity class=\"w-4 h-4 mr-2 inline\" /> Dashboard Analítico");
content = content.replace("⚠️ Alertas de Auditoria", "<AlertTriangle class=\"w-4 h-4 mr-2 inline\" /> Alertas de Auditoria");
content = content.replace("📥", "<UploadCloud class=\"w-8 h-8 text-safira\" />");
content = content.replace("🔍", "<Activity class=\"w-full h-full\" />"); // Big magnifying glass to activity

// Cards dashboard
content = content.replace("🚨", "<AlertCircle class=\"w-6 h-6 text-red-500\" />");
content = content.replace("⚠️", "<AlertTriangle class=\"w-6 h-6 text-amber-500\" />");
content = content.replace("💰", "<TrendingDown class=\"w-full h-full text-esmeralda\" />");
content = content.replace("��", "<DollarSign class=\"w-full h-full text-white\" />");
content = content.replace("⚠️ Erro no Bloco 1300", "<AlertTriangle class=\"w-3 h-3 inline mr-1\" /> Erro no Bloco 1300");
content = content.replace("✅ Consistente", "<CheckCircle2 class=\"w-3 h-3 inline mr-1\" /> Consistente");
content = content.replace("🎉", "<CheckCircle2 class=\"w-12 h-12 text-esmeralda mx-auto\" />");
content = content.replace("💡 ", ""); // Remove bulb
content = content.replace("🔮 Máquina de Cura: Retificação", "Ferramenta de Retificação");

fs.writeFileSync('../frontend/src/views/AnalisadorView.vue', content);
