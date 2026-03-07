# Estágio 1: Build da aplicação
FROM node:20 AS build-stage

WORKDIR /app

# Garantir ambiente de desenvolvimento para baixar o Vite
ENV NODE_ENV=development
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Copiar arquivos de dependência
COPY package*.json ./

# Instalação limpa
RUN npm install --loglevel=error

# Copiar código-fonte
COPY . .

# Comando de build com captura forçada de erro no terminal da Hostinger
RUN npm run build > vite_build.log 2>&1 || (echo "--- INÍCIO DO LOG DE ERRO VITE ---" && cat vite_build.log && echo "--- FIM DO LOG DE ERRO VITE ---" && exit 1)

# Estágio 2: Servir os arquivos com Nginx
FROM nginx:stable-alpine AS production-stage

# Copiar o build do estágio anterior para o diretório padrão do Nginx
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Expor a porta 80 para acesso web
EXPOSE 80

# Iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]
