# Estágio 1: Build da aplicação (Máxima Compatibilidade e Depuração)
# Usando imagem completa do Node (Debian) para garantir suporte a binários nativos do Vite/Tailwind 4
FROM node:20 AS build-stage

WORKDIR /app

# Configurações de ambiente para build verboso
ENV NODE_ENV=development
ENV CI=false

# Diagnóstico de Ambiente Inicial
RUN node -v && npm -v

# Copiar arquivos de dependência
COPY package*.json ./

# Instalação limpa das dependências
RUN npm install --loglevel=info

# Confirmar presença do executável do Vite
RUN ls -la node_modules/.bin/vite

# Copiar código-fonte completo
COPY . .

# Realizar o build para produção com REDIRECIONAMENTO TOTAL DE SAÍDA (stdout e stderr)
# Usamos npx para garantir a localização correta do binário e evitar erros de caminho
RUN npx vite build --logLevel info --debug 2>&1

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
