# Todo en uno: Node + TeX Live. No necesitas instalar LaTeX en tu equipo.
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    latexmk texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended texlive-lang-spanish \
    build-essential python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
ENV DB=/data/data.db
# Dentro del contenedor hay que escuchar en todas las interfaces para que Docker reenvíe los puertos
ENV LJTEX_HOST=0.0.0.0
EXPOSE 3000 1234
CMD ["node","server.js"]
