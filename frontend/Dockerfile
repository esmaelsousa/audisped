# Estágio 1: Build da aplicação (Ambiente Limpo e Seguro)
FROM node:20-bullseye-slim AS build-stage

WORKDIR /app

# Desativar CI rígido e configurar memória para VPS pequenas (1GB RAM)
ENV CI=false
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=768"

# Copiar APENAS o package.json para forçar nova resolução de dependências no Linux
# Ignoramos o package-lock.json local do Mac para evitar conflitos de binários nativos
COPY package.json ./

# Instalação limpa das dependências (incluindo devDependencies necessárias para o build)
RUN npm install --include=dev --loglevel=error --no-audit --no-fund

# Copiar o código-fonte (filtrado pelo .dockerignore)
COPY . .

# Realizar o build para produção
# Aumentamos a verbosidade caso falte algum arquivo
RUN npm run build || (echo "ERRO NO BUILD VITE - ANALISANDO ARQUIVOS:" && ls -la && ls -la src/ && exit 1)

# Estágio 2: Servir os arquivos com Nginx (Imagem ultra-leve)
FROM nginx:stable-alpine AS production-stage

# Limpar diretório padrão do Nginx
RUN rm -rf /usr/share/nginx/html/*

# Copiar o build do estágio anterior
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Expor a porta 80 para acesso web
EXPOSE 80

# Iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]
