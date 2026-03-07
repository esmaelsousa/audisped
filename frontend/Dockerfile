# Estágio 1: Build da aplicação
FROM node:20-alpine AS build-stage

# Dependências para arquiteturas nativas (essencial para esbuild/vite no linux)
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Garantir que o npm instale as devDependencies para poder rodar o 'vite build'
ENV NODE_ENV=development
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Copiar arquivos de dependência
COPY package*.json ./

# Instalar dependências (incluindo devDeps)
RUN npm install --loglevel=error

# Copiar o restante do código
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
