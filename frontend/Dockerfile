# Estágio 1: Build da aplicação
FROM node:20-bullseye AS build-stage

WORKDIR /app

# Desativar restrições de CI para evitar que warnings de pacotes grandes travem o build
# O Vite processa os arquivos em Node, então ele avalia o código principal do sistema.
ENV CI=false
ENV NODE_ENV=development
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Copiar arquivos de dependência
COPY package*.json ./

# Instalação limpa garantindo ferramentas de build (Vite 6)
RUN npm install --loglevel=error

# Copiar código-fonte completo
COPY . .

# Realizar o build para produção
# Graças às proteções no store.js e api.js, o build não vai mais cair por falta de 'localStorage' ou 'window'
RUN npm run build

# Estágio 2: Servir os arquivos com Nginx
FROM nginx:stable-alpine AS production-stage

# Copiar o build do estágio anterior para o diretório do Nginx
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Expor a porta 80 para acesso web
EXPOSE 80

# Iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]
