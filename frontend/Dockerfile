# Estágio 1: Build da aplicação
FROM node:20-bullseye AS build-stage

WORKDIR /app

# Desativar restrições de CI e configurar memória segura para VPS de 1GB
ENV CI=false
ENV NODE_ENV=development
ENV NODE_OPTIONS="--max-old-space-size=896"

# Copiar arquivos de dependência
COPY package*.json ./

# Instalar dependências (sem cache forçado para depuração)
RUN npm install --loglevel=info

# Listar dependências para confirmar instalação (Logs Hostinger)
RUN npm list --depth=0

# Copiar código-fonte
COPY . .

# Diagnóstico: Listar arquivos antes do build
RUN ls -laR src/

# Realizar o build para produção com saída detalhada
RUN npm run build -- --logLevel info

# Estágio 2: Servir os arquivos com Nginx
FROM nginx:stable-alpine AS production-stage
COPY --from=build-stage /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
