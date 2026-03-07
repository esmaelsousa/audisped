# Estágio 1: Build da aplicação
FROM node:20-bullseye-slim AS build-stage

WORKDIR /app

# Reduzir limite de memória para ser compatível com VPS menores (Ex: 1GB total)
ENV NODE_OPTIONS="--max-old-space-size=768"
ENV NODE_ENV=development

# Copiar arquivos de dependência
COPY package*.json ./

# Instalação limpa ignorando scripts de telemetria
RUN npm install --no-audit --no-fund --loglevel=error

# Copiar código-fonte
COPY . .

# Comando de build com captura de erro explícita no console da Hostinger
RUN npm run build || (echo "ERRO CRÍTICO NO BUILD VITE:" && npm run build -- --logLevel error)

# Estágio 2: Servir os arquivos com Nginx
FROM nginx:stable-alpine AS production-stage

# Copiar o build do estágio anterior para o diretório padrão do Nginx
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Expor a porta 80 para acesso web
EXPOSE 80

# Iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]
