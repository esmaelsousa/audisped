# Estágio 1: Build da aplicação
FROM node:20-slim AS build-stage

WORKDIR /app

# Copiar arquivos de configuração do frontend
COPY package*.json ./

# Instalar dependências
RUN npm install

# Copiar o restante do código do frontend
COPY . .

# Realizar o build para produção
RUN npm run build

# Estágio 2: Servir os arquivos com Nginx
FROM nginx:stable-alpine AS production-stage

# Copiar o build do estágio anterior para o diretório padrão do Nginx
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Expor a porta 80 para acesso web
EXPOSE 80

# Iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]
