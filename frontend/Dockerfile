# Estágio 1: Build da aplicação
FROM node:20-bullseye-slim AS build-stage

WORKDIR /app

# Garantir que o npm instale as devDependencies para poder rodar o 'vite build'
ENV NODE_ENV=development

# Copiar arquivos de dependência
COPY package*.json ./

# Limpar qualquer rastro anterior antes de instalar (evita erros de lockfile)
RUN rm -rf node_modules package-lock.json && npm install --loglevel=error

# Copiar o restante do código
COPY . .

# Garantir que a pasta dist esteja limpa antes do build
RUN rm -rf dist && npm run build

# Estágio 2: Servir os arquivos com Nginx
FROM nginx:stable-alpine AS production-stage

# Copiar o build do estágio anterior para o diretório padrão do Nginx
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Expor a porta 80 para acesso web
EXPOSE 80

# Iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]
