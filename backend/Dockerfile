# Usar uma imagem leve do Node.js
FROM node:18-slim

# Definir o diretório de trabalho
WORKDIR /app

# Copiar os arquivos de dependência
COPY package*.json ./

# Instalar dependências de produção
RUN npm install --omit=dev

# Copiar o restante do código do backend
COPY . .

# Expor a porta que o servidor utiliza (padrão 15435)
EXPOSE 15435

# Definir variáveis de ambiente padrão
ENV PORT=15435
ENV NODE_ENV=production

# Comando para iniciar o servidor
CMD ["npm", "start"]
