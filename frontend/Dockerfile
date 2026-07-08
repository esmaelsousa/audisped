# Estágio 1: Build da aplicação (Máxima Compatibilidade e Depuração)
# Usando imagem completa do Node (Debian) para garantir suporte a binários nativos do Vite/Tailwind 4
FROM node:20 AS build-stage

WORKDIR /app

# Configurações de ambiente para estabilidade de build
ENV NODE_ENV=production
ENV CI=true
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Diagnóstico de Ambiente Inicial
RUN node -v && npm -v

# Copiar arquivos de dependência
COPY package*.json ./

# Instalação das dependências — força incluir devDependencies (vite, tailwind, plugin-vue
# fazem o build e estão em devDependencies; com NODE_ENV=production o npm as pularia).
RUN npm install --include=dev

# Copiar código-fonte completo
COPY . .

# Realizar o build para produção
RUN npm run build

# Estágio 2: Servir os arquivos com Nginx
FROM nginx:stable-alpine AS production-stage

# Limpar diretório padrão
RUN rm -rf /usr/share/nginx/html/*

# Config do nginx com fallback SPA (Vue Router history mode) + gzip
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copiar o build do estágio anterior
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Expor a porta 80
EXPOSE 80

# Iniciar Nginx
CMD ["nginx", "-g", "daemon off;"]
