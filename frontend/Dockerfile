# Estágio 1: Build da aplicação
FROM node:20 AS build-stage

WORKDIR /app

# Garantir ambiente para build do Vite (devDependencies inclusas)
ENV NODE_ENV=development

# Reduzir RAM para caber em qualquer VPS (Evita ser morto pelo SO)
ENV NODE_OPTIONS="--max-old-space-size=512"

# Copiar arquivos de dependência
COPY package*.json ./

# Instalação limpa
RUN npm install --loglevel=error

# Copiar código-fonte
COPY . .

# Comando de build direto (sem redirecionar logs para garantir visibilidade se falhar)
RUN npm run build

# Estágio 2: Servir os arquivos com Nginx
FROM nginx:stable-alpine AS production-stage

# Copiar o build do estágio anterior para o diretório padrão do Nginx
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Expor a porta 80 para acesso web
EXPOSE 80

# Iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]
