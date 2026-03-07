# Estágio 1: Build da aplicação
FROM node:20 AS build-stage

WORKDIR /app

# Ignorar o tratamento de warnings como erros fatais (Ambientes de CI restritos)
ENV CI=false
ENV NODE_ENV=development
ENV NODE_OPTIONS="--max-old-space-size=1536"

# Copiar arquivos de dependência
COPY package*.json ./

# Instalação limpa garantindo todas as ferramentas de build (Vite 6)
RUN npm install --include=dev --loglevel=error

# Copiar o código completo (filtrado pelo .dockerignore)
COPY . .

# Realizar o build para produção
RUN npm run build

# Estágio 2: Servir os arquivos com Nginx
FROM nginx:stable-alpine AS production-stage

# Copiar o build do estágio anterior para o diretório do Nginx
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Expor a porta 80 para acesso web
EXPOSE 80

# Iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]
