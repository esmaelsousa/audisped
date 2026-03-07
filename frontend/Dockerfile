# Estágio 1: Build da aplicação
FROM node:20 AS build-stage

WORKDIR /app

# Ignorar o tratamento de warnings como erros fatais (Hostinger/CI)
ENV CI=false
ENV NODE_ENV=development
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Copiar arquivos de dependência
COPY package*.json ./

# Instalação limpa GARANTINDO todas as ferramentas de build
RUN npm install --include=dev --loglevel=error

# Copiar o código completo
COPY . .

# Comando de build direto usando npx para evitar caminhos relativos do npm
RUN npx vite build

# Estágio 2: Servir os arquivos com Nginx
FROM nginx:stable-alpine AS production-stage

# Copiar o build do estágio anterior para o diretório padrão do Nginx
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Expor a porta 80 para acesso web
EXPOSE 80

# Iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]
