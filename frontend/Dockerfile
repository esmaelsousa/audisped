# Estágio 1: Build da aplicação
FROM node:20 AS build-stage

WORKDIR /app

# Aumentar limite de memória para o build (ajuda em VPS menores)
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Copiar arquivos de dependência
COPY package*.json ./

# Instalar dependências (usando ci para maior fidelidade ao ambiente local/git)
RUN npm ci

# Copiar o restante do código
COPY . .

# Realizar o build com log de erro detalhado
RUN npm run build || (echo "Build failed! Logs follow:" && npm run build -- --debug)

# Estágio 2: Servir os arquivos com Nginx
FROM nginx:stable-alpine AS production-stage

# Copiar o build do estágio anterior para o diretório padrão do Nginx
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Expor a porta 80 para acesso web
EXPOSE 80

# Iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]
