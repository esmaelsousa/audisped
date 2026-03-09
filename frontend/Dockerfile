# Estágio 1: Build da aplicação (Sugerido pelo suporte Hostinger)
FROM node:20-alpine AS build-stage

WORKDIR /app

# Configurações de ambiente para build
ENV NODE_ENV=development
ENV CI=false

# Copiar arquivos de dependência (lockfile sincronizado no Mac)
COPY package.json package-lock.json ./

# Instalação rigorosa (npm ci é o padrão para ambientes de produção/CI na Hostinger)
RUN npm ci

# Copiar código-fonte completo
COPY . .

# Realizar o build para produção
RUN npm run build

# Estágio 2: Servir os arquivos com Nginx
FROM nginx:stable-alpine AS production-stage

# Limpar diretório padrão
RUN rm -rf /usr/share/nginx/html/*

# Copiar o build do estágio anterior
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Expor a porta 80
EXPOSE 80

# Iniciar Nginx
CMD ["nginx", "-g", "daemon off;"]
